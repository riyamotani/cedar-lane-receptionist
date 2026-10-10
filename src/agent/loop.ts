import OpenAI from 'openai';
import { env } from '../config/env';
import { nowInShop } from '../lib/time';
import { TOOLS, findTool } from '../tools';
import type { ToolContext, ToolResult } from '../tools/define';
import { buildSystemPrompt } from './prompt';

export type ChatHistory = OpenAI.Chat.ChatCompletionMessageParam[];

const client = new OpenAI({ apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL });

// Stops a model stuck in a tool-calling loop from burning credit forever.
const MAX_TOOL_ROUNDS = 8;
const FALLBACK_REPLY = "Sorry, I'm having trouble with that. I'll have someone from the team call you back.";

const toolDefinitions: OpenAI.Chat.ChatCompletionTool[] = TOOLS.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

// Runs one caller message to completion: call the LLM, run any tools it asks for, feed the
// results back, repeat until it answers in plain text. Mutates history so the next turn has context.
export async function runAgentTurn(history: ChatHistory, userText: string, ctx: ToolContext): Promise<string> {
  // If anything throws mid-turn (e.g. the LLM API fails), undo this turn's messages. Otherwise
  // history could end in a tool call with no result, and the API rejects every later request.
  const checkpoint = history.length;
  try {
    return await runTurn(history, userText, ctx);
  } catch (err) {
    history.length = checkpoint;
    throw err;
  }
}

async function runTurn(history: ChatHistory, userText: string, ctx: ToolContext): Promise<string> {
  history.push({ role: 'user', content: userText });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.chat.completions.create({
      model: env.LLM_MODEL,
      // Rebuilt every call so "now" and the date table are always current.
      messages: [{ role: 'system', content: buildSystemPrompt(nowInShop()) }, ...history],
      tools: toolDefinitions,
    });
    const message = response.choices[0]?.message;
    if (!message) throw new Error('LLM returned no message');
    history.push(message);

    if (!message.tool_calls?.length) return message.content ?? '';

    // Run tool calls one after another, in order: a check followed by a booking must not race.
    for (const call of message.tool_calls) {
      const result = await runToolCall(call, ctx);
      history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  history.push({ role: 'assistant', content: FALLBACK_REPLY });
  return FALLBACK_REPLY;
}

async function runToolCall(call: OpenAI.Chat.ChatCompletionMessageToolCall, ctx: ToolContext): Promise<ToolResult> {
  if (call.type !== 'function') {
    return { ok: false, error: 'unsupported_tool_call', message: 'Only function tools are supported.' };
  }
  const tool = findTool(call.function.name);
  if (!tool) {
    return { ok: false, error: 'unknown_tool', message: `There is no tool called ${call.function.name}.` };
  }

  // The LLM sends arguments as a JSON string; it can be malformed, so parse defensively.
  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { ok: false, error: 'invalid_json', message: 'Tool arguments were not valid JSON.' };
  }

  const result = await tool.run(args, ctx);
  console.log(`  [${tool.name}] ${JSON.stringify(args)}\n  -> ${JSON.stringify(result)}`);
  return result;
}
