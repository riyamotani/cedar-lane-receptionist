import { DateTime } from 'luxon';
import { SHOP } from '../config/business';
import { openingHours } from '../lib/time';

// Pure scheduling logic: no API calls. The tools fetch Calendar events, convert them,
// and pass them in, which keeps everything here testable with fake data and a frozen "now".

export interface Busy {
  start: DateTime;
  end: DateTime;
}

export interface Schedule {
  busy: Busy[]; // timed Calendar events; each one occupies one bay
  blockedDates: Set<string>; // shop-local "yyyy-MM-dd" dates with an all-day event (shop closed)
  now: DateTime;
}

export type SlotStatus =
  | 'open'
  | 'taken'
  | 'closed'
  | 'outside_hours'
  | 'off_grid'
  | 'too_soon'
  | 'too_far';

// Highest number of busy intervals running at the same moment inside [from, to).
// Bays aren't assigned in advance, so a new job fits whenever this is below the bay count.
export function maxConcurrent(busy: Busy[], from: DateTime, to: DateTime): number {
  const changes: { at: number; delta: number }[] = [];
  for (const b of busy) {
    if (b.start >= to || b.end <= from) continue; // doesn't overlap the window
    changes.push({ at: Math.max(b.start.toMillis(), from.toMillis()), delta: 1 });
    changes.push({ at: Math.min(b.end.toMillis(), to.toMillis()), delta: -1 });
  }
  // At the same instant, ends sort before starts: a 9-10 job and a 10-11 job never overlap.
  changes.sort((a, b) => a.at - b.at || a.delta - b.delta);

  let running = 0;
  let max = 0;
  for (const c of changes) {
    running += c.delta;
    max = Math.max(max, running);
  }
  return max;
}

export function checkSlot(start: DateTime, durationMinutes: number, schedule: Schedule): SlotStatus {
  const local = start.setZone(SHOP.timezone);
  const end = local.plus({ minutes: durationMinutes });

  const hours = openingHours(local);
  if (!hours || schedule.blockedDates.has(local.toFormat('yyyy-MM-dd'))) return 'closed';
  if (local < hours.open || end > hours.close) return 'outside_hours';
  if (local.diff(hours.open, 'minutes').minutes % SHOP.slotMinutes !== 0) return 'off_grid';
  if (local < schedule.now.plus({ minutes: SHOP.minNoticeMinutes })) return 'too_soon';
  if (local > schedule.now.plus({ days: SHOP.bookingHorizonDays })) return 'too_far';

  // Buffer = cleanup time after every job, so pad the end of existing jobs and of this one.
  const buffer = { minutes: SHOP.bufferMinutes };
  const padded = schedule.busy.map((b) => ({ start: b.start, end: b.end.plus(buffer) }));
  if (maxConcurrent(padded, local, end.plus(buffer)) >= SHOP.bays) return 'taken';

  return 'open';
}

// Every bookable start time on one shop-local day, in time order.
export function openSlotsOnDay(day: DateTime, durationMinutes: number, schedule: Schedule): DateTime[] {
  const hours = openingHours(day.setZone(SHOP.timezone));
  if (!hours) return [];

  const slots: DateTime[] = [];
  for (
    let t = hours.open;
    t.plus({ minutes: durationMinutes }) <= hours.close;
    t = t.plus({ minutes: SHOP.slotMinutes })
  ) {
    if (checkSlot(t, durationMinutes, schedule) === 'open') slots.push(t);
  }
  return slots;
}

// Up to `limit` alternatives: nearest open times on the requested day first (before or after),
// then the first open time on each following day. The caller must include busy events for
// the requested day plus `searchDays` days after it in the schedule.
export function findAlternatives(
  requested: DateTime,
  durationMinutes: number,
  schedule: Schedule,
  limit = 3,
  searchDays = 7,
): DateTime[] {
  const distance = (t: DateTime) => Math.abs(t.toMillis() - requested.toMillis());
  const sameDay = openSlotsOnDay(requested, durationMinutes, schedule)
    .filter((t) => t.toMillis() !== requested.toMillis())
    .sort((a, b) => distance(a) - distance(b));

  const result = sameDay.slice(0, limit);
  for (let i = 1; i <= searchDays && result.length < limit; i++) {
    const nextDay = requested.setZone(SHOP.timezone).startOf('day').plus({ days: i });
    const first = openSlotsOnDay(nextDay, durationMinutes, schedule)[0];
    if (first) result.push(first);
  }
  return result;
}
