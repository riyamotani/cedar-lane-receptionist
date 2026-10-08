import { DateTime } from 'luxon';
import { SHOP, HOURS, CLOSED_DATES } from '../config/business';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

export type TimeResolution =
  | { kind: 'ok'; start: DateTime }
  | { kind: 'ambiguous'; options: DateTime[] }
  | { kind: 'outside_hours' }
  | { kind: 'invalid' };

export function nowInShop(): DateTime {
  return DateTime.now().setZone(SHOP.timezone);
}

// "2026-10-08" -> midnight that day in shop time, or null if malformed/impossible (e.g. Feb 30).
export function parseShopDate(date: string): DateTime | null {
  if (!DATE_PATTERN.test(date)) return null;
  const day = DateTime.fromISO(date, { zone: SHOP.timezone });
  return day.isValid ? day : null;
}

// Opening and closing moments for a shop-local day, or null if the shop is closed that day.
export function openingHours(day: DateTime): { open: DateTime; close: DateTime } | null {
  const isoDate = day.toFormat('yyyy-MM-dd');
  if (CLOSED_DATES.includes(isoDate)) return null;
  const hours = HOURS[day.weekday];
  if (!hours) return null;
  return {
    open: DateTime.fromISO(`${isoDate}T${hours.open}`, { zone: SHOP.timezone }),
    close: DateTime.fromISO(`${isoDate}T${hours.close}`, { zone: SHOP.timezone }),
  };
}

// Turns what the caller said ("4:30", optional am/pm) into a start time, using business
// hours to settle am vs pm. Only checks the start is within opening hours; whether the
// job fits, bay capacity and notice rules are the availability module's job.
export function resolveTime(day: DateTime, time: string, meridiem?: 'am' | 'pm'): TimeResolution {
  const match = TIME_PATTERN.exec(time);
  if (!match) return { kind: 'invalid' };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return { kind: 'invalid' };

  let candidateHours: number[];
  if (meridiem) {
    if (hour < 1 || hour > 12) return { kind: 'invalid' };
    candidateHours = [meridiem === 'am' ? hour % 12 : (hour % 12) + 12];
  } else if (hour === 0 || hour >= 13) {
    candidateHours = [hour];
  } else {
    candidateHours = [hour % 12, (hour % 12) + 12];
  }

  const hours = openingHours(day);
  if (!hours) return { kind: 'outside_hours' };

  const options = candidateHours
    .map((h) => day.set({ hour: h, minute, second: 0, millisecond: 0 }))
    .filter((start) => start >= hours.open && start < hours.close);

  const [first, second] = options;
  if (!first) return { kind: 'outside_hours' };
  if (second) return { kind: 'ambiguous', options };
  return { kind: 'ok', start: first };
}

// Google returns times like "2026-10-08T16:30:00-07:00"; convert to shop time, same instant.
export function fromGoogleIso(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: SHOP.timezone });
}

export function toGoogleIso(dt: DateTime): string {
  const iso = dt.toISO({ suppressMilliseconds: true });
  if (!iso) throw new Error('toGoogleIso called with an invalid DateTime');
  return iso;
}

// "Thursday, Oct 8 at 4:30 PM"
export function formatForCaller(dt: DateTime): string {
  return dt.setZone(SHOP.timezone).toFormat("cccc, LLL d 'at' h:mm a");
}
