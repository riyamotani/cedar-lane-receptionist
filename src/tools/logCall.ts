import { z } from 'zod';
import { recordInteraction } from '../google/sheets';
import { normalizePhone } from '../lib/phone';
import { defineTool } from './define';

export const INTENTS = [
  'booking', 'availability', 'pricing', 'hours', 'prep', 'vehicle_type',
  'reschedule', 'cancel', 'running_late', 'complaint', 'other',
] as const;

export const logCall = defineTool({
  name: 'log_call',
  description:
    'Save a short summary of this conversation for the shop staff. Call it once when the conversation ' +
    'is wrapping up (the caller says thanks, bye, or has nothing else), then say goodbye.',
  schema: z.object({
    summary: z.string().min(1).describe('One sentence: what the caller wanted and what happened.'),
    intents: z
      .array(z.enum(INTENTS))
      .min(1)
      .describe(
        'Everything the caller asked about. vehicle_type = asked whether we service a kind of vehicle ' +
          '(boats, RVs...), not just mentioning their car. availability = asked about open times.',
      ),
    name: z.string().optional().describe("Caller's name, if they gave it"),
    phone: z.string().optional().describe("Caller's phone number, if they gave it"),
  }),
  // No outcome field: the outcome (booked, handoff, ...) is set by the tool that did the action,
  // not by the model's description of it.
  async handler(input, ctx) {
    try {
      // Only a valid number becomes the contact key; an invalid one is dropped rather than
      // creating a contact row keyed by garbage.
      await recordInteraction(ctx.sessionId, ctx.channel, {
        summary: input.summary,
        intents: [...input.intents],
        name: input.name,
        phone: input.phone ? (normalizePhone(input.phone) ?? undefined) : undefined,
      });
      return { ok: true, logged: true };
    } catch (err) {
      // A logging failure must not change what the caller hears.
      console.error('[log_call] Sheets write failed:', err);
      return { ok: true, logged: false };
    }
  },
});
