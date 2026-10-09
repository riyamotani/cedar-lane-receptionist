import { z } from 'zod';
import { checkSlot, findAlternatives } from '../domain/availability';
import { createBooking, findBookingsByPhone } from '../google/calendar';
import { runExclusive } from '../lib/mutex';
import { normalizePhone } from '../lib/phone';
import { nowInShop, parseShopDate, resolveTime } from '../lib/time';
import { defineTool, fail } from './define';
import { STATUS_MESSAGES, bookingView, fields, resolveService, scheduleAround, slotView } from './common';

export const bookAppointment = defineTool({
  name: 'book_appointment',
  description:
    'Book an appointment once the caller has chosen a time and given their name and phone number. ' +
    'Re-checks availability itself, so it is safe even if the slot was just taken.',
  schema: z.object({
    service_id: fields.service_id,
    vehicle_size: fields.vehicle_size,
    date: fields.date,
    time: fields.time,
    name: z.string().trim().min(1).describe("Caller's name"),
    phone: z.string().describe("Caller's phone number, digits as given"),
    notes: z.string().optional().describe('Anything useful for the detailer, e.g. "dog hair in back seat"'),
    additional_booking_confirmed: z
      .boolean()
      .optional()
      .describe('Set true only after the caller confirms this is an extra booking on top of an existing one.'),
  }),
  async handler(input) {
    const phone = normalizePhone(input.phone);
    if (!phone) return fail('invalid_phone', 'That is not a valid 10-digit US or Canada number. Ask again.');
    const svc = resolveService(input.service_id, input.vehicle_size);
    if (!svc.ok) return svc;
    const day = parseShopDate(input.date);
    if (!day) return fail('invalid_date', 'Date must be a real date in YYYY-MM-DD format.');
    const resolved = resolveTime(day, input.time);
    if (resolved.kind === 'invalid') return fail('invalid_time', `Got "${input.time}", which is not a real time. Use H:mm, e.g. '4:30'.`);
    if (resolved.kind === 'ambiguous') return fail('ambiguous_time', 'Ask whether they mean morning or evening.');
    if (resolved.kind === 'outside_hours') {
      return fail('outside_hours', 'Outside opening hours or the shop is closed that day. Use check_availability to find open times.');
    }
    const start = resolved.start;

    // One booking at a time: nothing can be written between our check and our insert.
    return runExclusive(async () => {
      const now = nowInShop();
      const existing = await findBookingsByPhone(phone, now);

      // Same caller, same service, same time: usually the LLM or caller repeating themselves, so
      // return the existing booking. Only an explicit confirmation (e.g. a second car) books another.
      const duplicate = existing.find(
        (b) => b.serviceId === svc.service.id && b.start.toMillis() === start.toMillis(),
      );
      if (duplicate && !input.additional_booking_confirmed) {
        return { ok: true, already_booked: true, booking: bookingView(duplicate) };
      }

      // A different upcoming booking: maybe a second car, maybe they meant to reschedule. Ask first.
      if (existing.length > 0 && !input.additional_booking_confirmed) {
        return fail(
          'has_existing_booking',
          'This caller already has an upcoming booking. Ask whether this is an additional booking or a change to the existing one.',
          // No customer name: a phone number isn't proof of identity, so don't reveal who booked.
          { existing_bookings: existing.map((b) => ({ ...bookingView(b), name: undefined })) },
        );
      }

      const schedule = await scheduleAround(start, now);
      const status = checkSlot(start, svc.minutes, schedule);
      if (status !== 'open') {
        return fail('slot_unavailable', STATUS_MESSAGES[status], {
          status,
          alternatives: findAlternatives(start, svc.minutes, schedule).map(slotView),
        });
      }

      const booking = await createBooking({
        serviceId: svc.service.id,
        serviceName: svc.service.name,
        vehicleSize: input.vehicle_size,
        name: input.name,
        phone,
        price: svc.price,
        start,
        end: start.plus({ minutes: svc.minutes }),
        notes: input.notes,
      });
      return { ok: true, booked: true, booking: bookingView(booking) };
    });
  },
});
