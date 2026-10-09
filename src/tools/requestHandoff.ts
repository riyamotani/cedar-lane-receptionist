import { z } from 'zod';
import { callbackPromise } from '../domain/callback';
import { recordInteraction } from '../google/sheets';
import { normalizePhone } from '../lib/phone';
import { nowInShop } from '../lib/time';
import { defineTool, fail } from './define';
import { INVALID_PHONE, fields } from './common';

const CATEGORIES = ['billing', 'refund', 'damage', 'quote', 'manager', 'other'] as const;
const INTENT_FOR: Record<(typeof CATEGORIES)[number], string> = {
  billing: 'complaint',
  refund: 'complaint',
  damage: 'complaint',
  manager: 'complaint',
  quote: 'pricing',
  other: 'other',
};

export const requestHandoff = defineTool({
  name: 'request_human_handoff',
  description:
    'Pass the caller to a human: billing questions or complaints, refunds, damage claims, ceramic or fleet quotes, ' +
    'manager requests, or anything you are unsure about. Logs it for staff and returns the callback promise to tell the caller.',
  schema: z.object({
    category: z.enum(CATEGORIES),
    reason: z.string().min(1).describe('One sentence on what they need, close to their own words'),
    phone: fields.phone,
    name: fields.name.optional(),
  }),
  async handler(input, ctx) {
    const phone = normalizePhone(input.phone);
    if (!phone) return fail('invalid_phone', INVALID_PHONE);

    // The promise is computed from opening hours, never invented by the model.
    const promise = callbackPromise(nowInShop());
    // Not wrapped in try/catch: the Sheet row IS the handoff. If it can't be saved, the tool
    // must fail rather than promise a callback nobody knows about.
    await recordInteraction(ctx.sessionId, ctx.channel, {
      phone,
      name: input.name,
      intents: [INTENT_FOR[input.category]],
      outcome: 'handoff',
      handoffReason: `${input.category}: ${input.reason}`,
      callbackBy: promise.by.toFormat('yyyy-MM-dd HH:mm'),
      status: 'open',
    });
    return {
      ok: true,
      callback_promise: promise.text,
      message: `Tell the caller someone from the team will call them back ${promise.text}.`,
    };
  },
});
