import { z } from 'zod';
import { checkSlot, findAlternatives } from '../domain/availability';
import { moveBooking } from '../google/calendar';
import { recordInBackground } from '../google/sheets';
import { runExclusive } from '../lib/mutex';
import { normalizePhone } from '../lib/phone';
import { nowInShop } from '../lib/time';
import { defineTool, fail } from './define';
import {
  INVALID_PHONE,
  STATUS_MESSAGES,
  bookingView,
  fields,
  getOwnedBooking,
  resolveRequestedStart,
  scheduleAround,
  slotView,
} from './common';

export const rescheduleAppointment = defineTool({
  name: 'reschedule_appointment',
  description:
    'Move an existing booking to a new date and time. Get the event_id from find_appointments. ' +
    'Re-checks availability itself and returns alternatives if the new time is taken.',
  schema: z.object({
    phone: fields.phone,
    name: fields.name,
    event_id: z.string().describe('The booking to move, from find_appointments'),
    new_date: fields.date,
    new_time: fields.time,
  }),
  async handler(input, ctx) {
    const phone = normalizePhone(input.phone);
    if (!phone) return fail('invalid_phone', INVALID_PHONE);
    const requested = resolveRequestedStart(input.new_date, input.new_time);
    if (!requested.ok) return requested;
    const start = requested.start;

    // Same queue as booking: no other booking can take the slot between our check and the move.
    return runExclusive(async () => {
      const now = nowInShop();
      const owned = await getOwnedBooking(input.event_id, phone, input.name);
      if (!owned.ok) return owned;
      const old = owned.booking;
      if (old.start <= now) {
        return fail('already_started', "That booking has already started or passed, so it can't be moved. Offer a callback.");
      }

      // Keep the duration that was booked, even if config durations change later.
      const minutes = old.end.diff(old.start, 'minutes').minutes;
      // Leave the booking itself out, or it would conflict with its own new slot.
      const schedule = await scheduleAround(start, now, old.eventId);
      const status = checkSlot(start, minutes, schedule);
      if (status !== 'open') {
        return fail('slot_unavailable', STATUS_MESSAGES[status], {
          status,
          alternatives: findAlternatives(start, minutes, schedule).map(slotView),
        });
      }

      // Move rather than cancel-and-rebook: the customer is never left without a booking.
      const moved = await moveBooking(old.eventId, start, start.plus({ minutes }));
      recordInBackground('reschedule_appointment', ctx.sessionId, ctx.channel, {
        phone,
        name: input.name,
        intents: ['reschedule'],
        outcome: 'rescheduled',
        eventId: moved.eventId,
      });
      return { ok: true, rescheduled: true, previous: slotView(old.start), booking: bookingView(moved) };
    });
  },
});
