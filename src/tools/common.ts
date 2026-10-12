import type { DateTime } from 'luxon';
import { z } from 'zod';
import { SERVICES, SHOP, VEHICLE_SIZES, findService, type VehicleSize } from '../config/business';
import { formatForCaller, formatForSpeech, nowInShop, openingHours, resolveShopDay, resolveTime } from '../lib/time';
import type { Schedule, SlotStatus } from '../domain/availability';
import { findBookingsByPhone, getBooking, getSchedule, type Booking } from '../google/calendar';
import { fail } from './define';

// Schema fields shared by several tools, so their descriptions stay identical.
export const fields = {
  service_id: z.string().describe(`Service id: ${SERVICES.map((s) => s.id).join(', ')}`),
  vehicle_size: z
    .enum(VEHICLE_SIZES)
    .describe('sedan, suv or truck_van. Ask the caller if unknown; map models (Civic = sedan, RAV4 = suv, F-150 = truck_van).'),
  // The model copies the caller's word; code works out the date. A model asked to convert
  // "Thursday" itself once sent Wednesday's date.
  date: z
    .string()
    .describe(
      "The day exactly as the caller said it: a weekday ('thursday', 'next thursday'), 'today' or 'tomorrow'. " +
        "Never turn a weekday into a date yourself. Only if they gave a calendar date ('October 15th'), pass it as YYYY-MM-DD.",
    ),
  // No separate am/pm field: an empty optional field invites the model to guess. It copies what
  // the caller said instead, and code works out am/pm from opening hours.
  // The pattern is shown to the LLM up front; the error echoes what it sent so it can see its mistake.
  time: z
    .string()
    .regex(/^\d{1,2}:\d{2}\s*(am|pm)?$/i, {
      error: (issue) => `Got "${String(issue.input)}". Use H:mm, optionally followed by am/pm, e.g. '4:30' or '4:30 pm'.`,
    })
    .describe(
      "Time exactly as the caller said it, as H:mm. Add am/pm ONLY if the caller said am/pm, morning, afternoon or evening. " +
        "'3:30' -> '3:30'; 'half past four' -> '4:30'; '7 in the evening' -> '7:00 pm'.",
    ),
  phone: z.string().describe("Caller's phone number, digits as given"),
  name: z.string().trim().min(1).describe("Caller's name as they gave it"),
};

export const INVALID_PHONE = 'That is not a valid 10-digit US or Canada number. Ask again.';

export const STATUS_MESSAGES: Record<SlotStatus, string> = {
  open: 'That time is available.',
  taken: 'That time is fully booked. Offer the alternatives.',
  closed: 'The shop is closed that day.',
  outside_hours: 'That time is outside opening hours, or the job would finish after closing.',
  off_grid: `Appointments start every ${SHOP.slotMinutes} minutes, on the hour or half hour.`,
  too_soon: `Bookings need at least ${SHOP.minNoticeMinutes} minutes' notice.`,
  too_far: `Bookings can only be made up to ${SHOP.bookingHorizonDays} days ahead.`,
};

// Validates the service and size combination and looks up how long it takes and what it costs.
export function resolveService(serviceId: string, size: VehicleSize) {
  const service = findService(serviceId);
  if (!service) {
    return fail('unknown_service', `Unknown service_id "${serviceId}". Valid ids: ${SERVICES.map((s) => s.id).join(', ')}.`);
  }
  if (!service.options) {
    return fail('quote_only', `${service.name} is priced by quote after inspection and can't be booked directly. Offer a callback: request_human_handoff with category quote.`);
  }
  const { minutes, price } = service.options[size];
  return { ok: true as const, service, minutes, price };
}

// The day as the caller said it -> a shop-local date. When they name today's weekday
// ("Thursday" on a Thursday) and that time, or the whole working day, has already passed,
// they mean next week.
export function resolveRequestedDay(date: string, time: string | undefined, now: DateTime) {
  const said = resolveShopDay(date, now);
  if (!said) {
    return fail('invalid_date', `Got "${date}". Use a weekday ("thursday"), "today", "tomorrow", or a real date as YYYY-MM-DD.`);
  }
  if (!said.isTodayByWeekday) return { ok: true as const, day: said.day };

  const resolved = time ? resolveTime(said.day, time) : null;
  const hours = openingHours(said.day);
  const passed = resolved?.kind === 'ok' ? resolved.start <= now : hours !== null && now >= hours.close;
  return { ok: true as const, day: passed ? said.day.plus({ days: 7 }) : said.day };
}

// Date + time as the caller said them -> a start time, or a failure the LLM can act on.
// Shared by booking and rescheduling so both reject bad input the same way.
export function resolveRequestedStart(date: string, time: string) {
  const requestedDay = resolveRequestedDay(date, time, nowInShop());
  if (!requestedDay.ok) return requestedDay;
  const resolved = resolveTime(requestedDay.day, time);
  if (resolved.kind === 'invalid') return fail('invalid_time', `Got "${time}", which is not a real time. Use H:mm, e.g. '4:30'.`);
  if (resolved.kind === 'ambiguous') return fail('ambiguous_time', 'Ask whether they mean morning or evening.');
  if (resolved.kind === 'outside_hours') {
    return fail('outside_hours', 'Outside opening hours or the shop is closed that day. Use check_availability to find open times.');
  }
  return { ok: true as const, start: resolved.start };
}

// Identity check for existing bookings: the phone must match (enforced by the lookup) AND the
// first name must match. A phone number alone isn't identity, so a mismatch reveals nothing.
const firstName = (s: string) => s.trim().toLowerCase().split(/\s+/)[0] ?? '';
const sameFirstName = (a: string, b: string) => firstName(a) !== '' && firstName(a) === firstName(b);
const NAME_MISMATCH =
  "The name doesn't match the booking under this number. Don't share any booking details; ask them to check the name or number, or offer a callback.";

export async function findCallerBookings(phone: string, name: string, now: DateTime) {
  const all = await findBookingsByPhone(phone, now);
  if (all.length === 0) return fail('no_bookings', 'No upcoming bookings under that number. Ask them to double-check it.');
  const mine = all.filter((b) => sameFirstName(b.name, name));
  if (mine.length === 0) return fail('name_mismatch', NAME_MISMATCH);
  return { ok: true as const, bookings: mine };
}

// For tools that act on one booking by id: the id came from the LLM, so re-check ownership.
export async function getOwnedBooking(eventId: string, phone: string, name: string) {
  const booking = await getBooking(eventId);
  if (!booking || booking.phone !== phone) {
    return fail('not_found', 'No booking with that id under this number. Use find_appointments first.');
  }
  if (!sameFirstName(booking.name, name)) return fail('name_mismatch', NAME_MISMATCH);
  return { ok: true as const, booking };
}

// Busy events for the day plus the following week, which is what findAlternatives searches.
export function scheduleAround(day: DateTime, now: DateTime, excludeEventId?: string): Promise<Schedule> {
  const start = day.startOf('day');
  return getSchedule(start, start.plus({ days: 8 }), now, excludeEventId);
}

// That day's opening hours as text ("8:00 AM to 6:00 PM"), or null if the shop is closed:
// weekly closing day, holiday, or a staff all-day event on the calendar.
export function hoursText(day: DateTime, schedule: Schedule): string | null {
  const hours = openingHours(day);
  if (!hours || schedule.blockedDates.has(day.toFormat('yyyy-MM-dd'))) return null;
  return `${hours.open.toFormat('h:mm a')} to ${hours.close.toFormat('h:mm a')}`;
}

// Times always reach the LLM with a label written by code, so it never works out weekdays itself.
// "spoken" is the same label written out in words, for the voice channel.
export function slotView(dt: DateTime) {
  return {
    date: dt.toFormat('yyyy-MM-dd'),
    time: dt.toFormat('HH:mm'),
    label: formatForCaller(dt),
    spoken: formatForSpeech(dt),
  };
}

export function bookingView(b: Booking) {
  return {
    event_id: b.eventId,
    service: findService(b.serviceId)?.name ?? b.serviceId,
    vehicle_size: b.vehicleSize,
    name: b.name,
    price: b.price,
    ...slotView(b.start),
  };
}
