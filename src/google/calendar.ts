import { randomUUID } from 'node:crypto';
import type { calendar_v3 } from 'googleapis';
import { DateTime } from 'luxon';
import { calendar } from './auth';
import { env } from '../config/env';
import { SHOP, type VehicleSize } from '../config/business';
import { fromGoogleIso, toGoogleIso } from '../lib/time';
import { withRetry, httpStatus } from '../lib/retry';
import type { Busy, Schedule } from '../domain/availability';

// The only module that talks to Google Calendar. Converts Google's event format to and
// from our types so the tools never see Google's API shapes.

export interface Booking {
  eventId: string;
  serviceId: string;
  vehicleSize: VehicleSize;
  name: string;
  phone: string; // E.164
  price: number;
  start: DateTime;
  end: DateTime;
}

export interface NewBooking {
  serviceId: string;
  serviceName: string;
  vehicleSize: VehicleSize;
  vehicle?: string; // make and model, e.g. "Honda Civic"
  name: string;
  phone: string;
  price: number;
  start: DateTime;
  end: DateTime;
  notes?: string;
  source?: string; // 'ai-receptionist' by default; the seed script uses 'seed'
}

const calendarId = env.GOOGLE_CALENDAR_ID;

async function listEvents(
  from: DateTime,
  to: DateTime,
  privateExtendedProperty?: string[],
): Promise<calendar_v3.Schema$Event[]> {
  const items: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() =>
      calendar.events.list({
        calendarId,
        timeMin: toGoogleIso(from),
        timeMax: toGoogleIso(to),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
        privateExtendedProperty,
        pageToken,
      }),
    );
    items.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return items;
}

// Our bookings carry their details in hidden private properties. Events staff add by hand
// don't, so they return null here (they still block a bay in getSchedule).
function toBooking(e: calendar_v3.Schema$Event): Booking | null {
  const p = e.extendedProperties?.private;
  if (!e.id || !p?.phone || !p.serviceId || !e.start?.dateTime || !e.end?.dateTime) return null;
  return {
    eventId: e.id,
    serviceId: p.serviceId,
    vehicleSize: p.vehicleSize as VehicleSize,
    name: p.name ?? '',
    phone: p.phone,
    price: Number(p.price),
    start: fromGoogleIso(e.start.dateTime),
    end: fromGoogleIso(e.end.dateTime),
  };
}

// Everything the availability module needs for [from, to). excludeEventId leaves out the
// booking being rescheduled so it doesn't conflict with itself.
export async function getSchedule(
  from: DateTime,
  to: DateTime,
  now: DateTime,
  excludeEventId?: string,
): Promise<Schedule> {
  const busy: Busy[] = [];
  const blockedDates = new Set<string>();

  for (const e of await listEvents(from, to)) {
    if (e.id === excludeEventId) continue;
    if (e.start?.dateTime && e.end?.dateTime) {
      busy.push({ start: fromGoogleIso(e.start.dateTime), end: fromGoogleIso(e.end.dateTime) });
    } else if (e.start?.date && e.end?.date) {
      // All-day event: Google's end date is exclusive, so block each date before it.
      const last = DateTime.fromISO(e.end.date, { zone: SHOP.timezone });
      for (let d = DateTime.fromISO(e.start.date, { zone: SHOP.timezone }); d < last; d = d.plus({ days: 1 })) {
        blockedDates.add(d.toFormat('yyyy-MM-dd'));
      }
    }
  }
  return { busy, blockedDates, now };
}

export async function createBooking(b: NewBooking): Promise<Booking> {
  // We choose the event id up front, so if a retry hits "already exists" (409) we know the
  // first attempt succeeded and its response was lost: no duplicate event. UUID hex digits are
  // valid in Google event ids.
  const eventId = randomUUID().replace(/-/g, '');
  const requestBody: calendar_v3.Schema$Event = {
    id: eventId,
    summary: `${b.serviceName} – ${b.name} (${b.vehicleSize})`,
    description: [
      `Customer: ${b.name}`,
      `Phone: ${b.phone}`,
      `Vehicle: ${b.vehicle ? `${b.vehicle} (${b.vehicleSize})` : b.vehicleSize}`,
      `Quoted price: $${b.price}`,
      b.notes ? `Notes: ${b.notes}` : '',
      'Booked by the AI receptionist.',
    ]
      .filter(Boolean)
      .join('\n'),
    start: { dateTime: toGoogleIso(b.start), timeZone: SHOP.timezone },
    end: { dateTime: toGoogleIso(b.end), timeZone: SHOP.timezone },
    extendedProperties: {
      private: {
        phone: b.phone,
        name: b.name,
        serviceId: b.serviceId,
        vehicleSize: b.vehicleSize,
        price: String(b.price),
        source: b.source ?? 'ai-receptionist',
      },
    },
  };

  try {
    const res = await withRetry(() => calendar.events.insert({ calendarId, requestBody }));
    return toBooking(res.data)!;
  } catch (err) {
    if (httpStatus(err) !== 409) throw err;
    const existing = await getBooking(eventId);
    if (!existing) throw err;
    return existing;
  }
}

export async function getBooking(eventId: string): Promise<Booking | null> {
  try {
    const res = await withRetry(() => calendar.events.get({ calendarId, eventId }));
    if (res.data.status === 'cancelled') return null;
    return toBooking(res.data);
  } catch (err) {
    if (httpStatus(err) === 404 || httpStatus(err) === 410) return null;
    throw err;
  }
}

// Upcoming bookings for a phone number, matched exactly on the hidden E.164 property.
export async function findBookingsByPhone(phone: string, now: DateTime): Promise<Booking[]> {
  const events = await listEvents(now, now.plus({ days: SHOP.bookingHorizonDays + 1 }), [
    `phone=${phone}`,
  ]);
  return events.map(toBooking).filter((b): b is Booking => b !== null);
}

export async function moveBooking(eventId: string, start: DateTime, end: DateTime): Promise<Booking> {
  // patch is idempotent: sending the same new times twice gives the same result.
  const res = await withRetry(() =>
    calendar.events.patch({
      calendarId,
      eventId,
      requestBody: {
        start: { dateTime: toGoogleIso(start), timeZone: SHOP.timezone },
        end: { dateTime: toGoogleIso(end), timeZone: SHOP.timezone },
      },
    }),
  );
  return toBooking(res.data)!;
}

// Appends a line to the event description (e.g. "running 10 min late") so staff see it.
// Skips if the same line is already there, so a retried call doesn't add it twice.
export async function addNoteToBooking(eventId: string, note: string): Promise<void> {
  const res = await withRetry(() => calendar.events.get({ calendarId, eventId }));
  const description = res.data.description ?? '';
  if (description.includes(note)) return;
  await withRetry(() =>
    calendar.events.patch({ calendarId, eventId, requestBody: { description: `${description}\n${note}`.trim() } }),
  );
}

export async function cancelBooking(eventId: string): Promise<void> {
  try {
    await withRetry(() => calendar.events.delete({ calendarId, eventId }));
  } catch (err) {
    // Already gone (e.g. a retry after a lost response) means the cancel succeeded.
    if (httpStatus(err) !== 404 && httpStatus(err) !== 410) throw err;
  }
}
