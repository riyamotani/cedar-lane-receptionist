import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { summarizeCall } from '../agent/summarize';
import { required } from '../config/env';
import { recordInteraction } from '../google/sheets';
import { logEvent } from '../lib/log';
import { normalizePhone } from '../lib/phone';
import { findTool } from '../tools';
import type { ToolContext } from '../tools/define';

// Phase 2: Vapi runs the phone call, speech and LLM. When the LLM wants a tool, Vapi POSTs
// here and we run the SAME tool registry the text chat uses. Nothing about booking rules is
// duplicated for voice.

// log_call is chat-only; on voice the end-of-call report writes the summary.
export const VOICE_EXCLUDED_TOOLS = ['log_call'];

// Vapi's docs show two shapes for a tool call ({name, parameters} and {function: {name,
// arguments}}), so accept both. looseObject: Vapi sends many more fields than we read.
const ToolCall = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  parameters: z.unknown().optional(),
  arguments: z.unknown().optional(),
  function: z.looseObject({ name: z.string().optional(), arguments: z.unknown().optional() }).optional(),
});

const Body = z.object({
  message: z.looseObject({
    type: z.string(),
    call: z
      .looseObject({
        id: z.string().optional(),
        customer: z.looseObject({ number: z.string().optional() }).optional(),
      })
      .optional(),
    toolCallList: z.array(ToolCall).optional(),
    endedReason: z.string().optional(),
    summary: z.string().optional(),
    analysis: z.looseObject({ summary: z.string().optional() }).optional(),
    transcript: z.string().optional(),
    artifact: z.looseObject({ transcript: z.string().optional() }).optional(),
  }),
});

type VapiMessage = z.infer<typeof Body>['message'];

// Only Vapi knows the secret we gave it when syncing the assistant. Constant-time compare so
// the check doesn't leak how many characters matched.
function hasValidSecret(header: string | undefined): boolean {
  const expected = Buffer.from(required('VAPI_WEBHOOK_SECRET'));
  const given = Buffer.from(header ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function runToolCall(call: z.infer<typeof ToolCall>, ctx: ToolContext) {
  const name = call.name ?? call.function?.name ?? '';
  let args: unknown = call.parameters ?? call.arguments ?? call.function?.arguments ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {}; // falls through to the tool's own validation error
    }
  }

  const tool = VOICE_EXCLUDED_TOOLS.includes(name) ? undefined : findTool(name);
  const started = Date.now();
  const result = tool
    ? await tool.run(args, ctx) // run() validates and never throws
    : { ok: false, error: 'unknown_tool', message: `There is no tool called ${name}.` };
  // The time is logged because on a call every tool second is silence the caller hears.
  logEvent(ctx.sessionId, `  [${name}] ${Date.now() - started}ms ${JSON.stringify(args)}\n  -> ${JSON.stringify(result)}`);

  // Vapi requires the result as a single-line string; JSON.stringify produces exactly that.
  return { name, toolCallId: call.id, result: JSON.stringify(result) };
}

export const vapiRouter = Router();

vapiRouter.post('/', async (req, res) => {
  if (!hasValidSecret(req.get('x-vapi-secret'))) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'unrecognised payload' });
    return;
  }
  const { message } = parsed.data;
  // The Vapi call id is the session: every tool call in one phone call logs to one CallLog row.
  const ctx: ToolContext = { sessionId: message.call?.id ?? randomUUID(), channel: 'voice' };

  if (message.type === 'tool-calls') {
    // One at a time, in order, like the chat loop. Always HTTP 200: Vapi ignores any other
    // status and the assistant would say "no result returned".
    const results = [];
    for (const call of message.toolCallList ?? []) {
      results.push(await runToolCall(call, ctx));
    }
    res.json({ results });
    return;
  }

  // Answer Vapi first; the summary is written afterwards so a slow LLM call can't time out
  // the webhook.
  res.json({});
  if (message.type === 'end-of-call-report') {
    saveCallSummary(message, ctx.sessionId).catch((err) => {
      console.error('[vapi] could not save the call summary:', err);
    });
  }
});

// Vapi's own summary arrived empty in testing, so we write one from the transcript. `||` rather
// than `??` throughout: an empty string must fall through to the next source, not count as a value.
async function saveCallSummary(message: VapiMessage, sessionId: string): Promise<void> {
  const transcript = message.artifact?.transcript || message.transcript || '';
  const generated = transcript ? await summarizeCall(transcript) : null;
  const summary =
    generated?.summary ||
    message.analysis?.summary ||
    message.summary ||
    `Voice call ended (${message.endedReason || 'unknown reason'}); no summary available.`;

  const callerId = message.call?.customer?.number;
  await recordInteraction(sessionId, 'voice', {
    summary,
    intents: generated?.intents,
    phone: callerId ? (normalizePhone(callerId) ?? undefined) : undefined,
  });
  logEvent(sessionId, `call ended: ${summary}`);
}
