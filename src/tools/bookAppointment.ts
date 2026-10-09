import { z } from 'zod';
import { checkSlot, findAlternatives } from '../domain/availability';
import { createBooking, findBookingsByPhone } from '../google/calendar';
import { recordInteraction } from '../google/sheets';
import { runExclusive } from '../lib/mutex';
import { normalizePhone } from '../lib/phone';
import { nowInShop } from '../lib/time';
import { defineTool, fail } from './define';
import {
  INVALID_PHONE,
  STATUS_MESSAGES,
  bookingView,
  fields,
  resolveRequestedStart,
  resolveService,
  scheduleAround,
  slotView,
} from './common';

export const bookAppointment = defineTool({
  name: 'book_appointment',
  description:
    'Book an appointment once the caller has chosen a time and given their name and phone number. ' +
    'Re-checks availability itself, so it is safe even if the slot was just taken.',
  schema: z.object({
    service_id: fields.service_id,
    vehicle_size: fields.vehicle_size,
    vehicle: z.string().optional().describe("Make and model if the caller said it, e.g. 'Honda Civic'"),
    date: fields.date,
    time: fields.time,
    name: fields.name,
    phone: fields.phone,
    notes: z.string().optional().describe('Anything useful for the detailer, e.g. "dog hair in back seat"'),
    additional_booking_confirmed: z
      .boolean()
      .optional()
      .describe('Set true only after the caller confirms this is an extra booking on top of an existing one.'),
  }),
  async handler(input, ctx) {
    const phone = normalizePhone(input.phone);
    if (!phone) return fail('invalid_phone', INVALID_PHONE);
    const svc = resolveService(input.service_id, input.vehicle_size);
    if (!svc.ok) return svc;
    const requested = resolveRequestedStart(input.date, input.time);
    if (!requested.ok) return requested;
    const start = requested.start;

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
        vehicle: input.vehicle,
        name: input.name,
        phone,
        price: svc.price,
        start,
        end: start.plus({ minutes: svc.minutes }),
        notes: input.notes,
      });

      // The Calendar is the source of truth. If the Sheets update fails, the booking still
      // stands and the caller still hears it's booked; the error goes to the server log.
      try {
        await recordInteraction(ctx.sessionId, ctx.channel, {
          phone,
          name: input.name,
          vehicle: input.vehicle,
          vehicleSize: input.vehicle_size,
          booked: true,
          intents: ['booking'],
          outcome: 'booked',
          eventId: booking.eventId,
        });
      } catch (err) {
        console.error('[book_appointment] booked, but the Sheets update failed:', err);
      }
      return { ok: true, booked: true, booking: bookingView(booking) };
    });
  },
});
