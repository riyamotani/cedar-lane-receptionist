import { z } from 'zod';
import { SHOP } from '../config/business';
import { addNoteToBooking } from '../google/calendar';
import { recordInteraction } from '../google/sheets';
import { normalizePhone } from '../lib/phone';
import { nowInShop } from '../lib/time';
import { defineTool, fail } from './define';
import { INVALID_PHONE, bookingView, fields, findCallerBookings } from './common';

export const reportRunningLate = defineTool({
  name: 'report_running_late',
  description: "Record that the caller is running late for today's booking.",
  schema: z.object({
    phone: fields.phone,
    name: fields.name,
    minutes_late: z.number().int().min(1).max(240).describe('How many minutes late they expect to be'),
  }),
  async handler(input, ctx) {
    const phone = normalizePhone(input.phone);
    if (!phone) return fail('invalid_phone', INVALID_PHONE);
    const now = nowInShop();
    const found = await findCallerBookings(phone, input.name, now);
    if (!found.ok) return found;
    const today = found.bookings.find((b) => b.start.hasSame(now, 'day'));
    if (!today) {
      return fail('no_booking_today', 'They have no booking today. Check whether they have the right day (find_appointments).', {
        upcoming: found.bookings.map(bookingView),
      });
    }

    const withinGrace = input.minutes_late <= SHOP.lateGraceMinutes;
    if (withinGrace) {
      await addNoteToBooking(today.eventId, `Running ~${input.minutes_late} min late (customer called at ${now.toFormat('h:mm a')}).`);
    }
    try {
      await recordInteraction(ctx.sessionId, ctx.channel, {
        phone,
        name: input.name,
        intents: ['running_late'],
        outcome: withinGrace ? 'late_noted' : undefined,
        eventId: today.eventId,
      });
    } catch (err) {
      console.error('[report_running_late] Sheets update failed:', err);
    }

    return withinGrace
      ? { ok: true, within_grace: true, booking: bookingView(today), message: "Noted on the booking. Tell them that's fine and we'll see them soon." }
      : {
          ok: true,
          within_grace: false,
          booking: bookingView(today),
          message: `More than ${SHOP.lateGraceMinutes} minutes late can't be held. Offer to reschedule (check_availability with reschedule_event_id, then reschedule_appointment).`,
        };
  },
});
