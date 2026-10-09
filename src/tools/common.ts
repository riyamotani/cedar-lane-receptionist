import type { DateTime } from 'luxon';
import { z } from 'zod';
import { SERVICES, SHOP, VEHICLE_SIZES, findService, type VehicleSize } from '../config/business';
import { formatForCaller, openingHours } from '../lib/time';
import type { Schedule, SlotStatus } from '../domain/availability';
import { getSchedule, type Booking } from '../google/calendar';
import { fail } from './define';

// Schema fields shared by several tools, so their descriptions stay identical.
export const fields = {
  service_id: z.string().describe(`Service id: ${SERVICES.map((s) => s.id).join(', ')}`),
  vehicle_size: z
    .enum(VEHICLE_SIZES)
    .describe('sedan, suv or truck_van. Ask the caller if unknown; map models (Civic = sedan, RAV4 = suv, F-150 = truck_van).'),
  date: z.string().describe('Shop-local date as YYYY-MM-DD. Use the date table in your instructions.'),
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
};

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
    return fail('quote_only', `${service.name} is priced by quote after inspection and can't be booked directly. Offer a callback from the team.`);
  }
  const { minutes, price } = service.options[size];
  return { ok: true as const, service, minutes, price };
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
export function slotView(dt: DateTime) {
  return { date: dt.toFormat('yyyy-MM-dd'), time: dt.toFormat('HH:mm'), label: formatForCaller(dt) };
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
