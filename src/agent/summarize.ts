import { z } from 'zod';
import { env } from '../config/env';
import { INTENTS } from '../tools/logCall';
import { llm } from './llm';

// Voice calls have no log_call tool, so after the call ends we write the same two things it
// records in chat (a one-sentence summary and the intents) from the transcript. Runs after the
// caller has hung up, so it adds no delay to the call.
const Reply = z.object({ summary: z.string().trim().min(1), intents: z.array(z.string()).default([]) });

export interface CallSummary {
  summary: string;
  intents: string[];
}

export async function summarizeCall(transcript: string): Promise<CallSummary | null> {
  try {
    const response = await llm.chat.completions.create({
      model: env.LLM_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You write the staff call log for an auto detailing shop. Summarise the phone call transcript. ' +
            'Reply with JSON only: {"summary": "<one sentence: what the caller wanted and what happened>", ' +
            `"intents": [<everything the caller asked about, chosen from: ${INTENTS.join(', ')}>]}. ` +
            'Only state what the transcript shows.',
        },
        { role: 'user', content: transcript.slice(0, 20_000) },
      ],
      response_format: { type: 'json_object' },
    });
    const reply = Reply.parse(JSON.parse(response.choices[0]?.message.content ?? ''));
    // Keep only intents from our list; the model's output is untrusted like any other.
    const intents = reply.intents.filter((i) => (INTENTS as readonly string[]).includes(i));
    return { summary: reply.summary, intents: intents.length > 0 ? intents : ['other'] };
  } catch (err) {
    console.error('[summarize] could not summarise the call:', err);
    return null;
  }
}
