import { z } from 'zod';
import { cancelBooking } from '../google/calendar';
import { recordInteraction } from '../google/sheets';
import { normalizePhone } from '../lib/phone';
import { nowInShop } from '../lib/time';
import { defineTool, fail } from './define';
import { INVALID_PHONE, bookingView, fields, getOwnedBooking } from './common';

export const cancelAppointment = defineTool({
  name: 'cancel_appointment',
  description:
    'Cancel a booking. Get the event_id from find_appointments. ' +
    'Only call this after reading the booking back and the caller clearly confirming the cancellation.',
  schema: z.object({
    phone: fields.phone,
    name: fields.name,
    event_id: z.string().describe('The booking to cancel, from find_appointments'),
  }),
  async handler(input, ctx) {
    const phone = normalizePhone(input.phone);
    if (!phone) return fail('invalid_phone', INVALID_PHONE);
    const owned = await getOwnedBooking(input.event_id, phone, input.name);
    if (!owned.ok) return owned;
    const booking = owned.booking;
    if (booking.start <= nowInShop()) {
      return fail('already_started', "That booking has already started or passed, so it can't be cancelled here. Offer a callback.");
    }

    await cancelBooking(booking.eventId);
    try {
      await recordInteraction(ctx.sessionId, ctx.channel, {
        phone,
        name: input.name,
        intents: ['cancel'],
        outcome: 'cancelled',
        eventId: booking.eventId,
      });
    } catch (err) {
      console.error('[cancel_appointment] cancelled, but the Sheets update failed:', err);
    }
    return { ok: true, cancelled: true, booking: bookingView(booking) };
  },
});
