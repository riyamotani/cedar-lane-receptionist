import { z } from 'zod';
import { normalizePhone } from '../lib/phone';
import { nowInShop } from '../lib/time';
import { defineTool, fail } from './define';
import { INVALID_PHONE, bookingView, fields, findCallerBookings } from './common';

export const findAppointments = defineTool({
  name: 'find_appointments',
  description:
    "Look up the caller's upcoming bookings by phone number and name. " +
    'Use before rescheduling, cancelling or reporting a late arrival.',
  schema: z.object({ phone: fields.phone, name: fields.name }),
  async handler(input) {
    const phone = normalizePhone(input.phone);
    if (!phone) return fail('invalid_phone', INVALID_PHONE);
    const found = await findCallerBookings(phone, input.name, nowInShop());
    if (!found.ok) return found;
    return { ok: true, bookings: found.bookings.map(bookingView) };
  },
});
