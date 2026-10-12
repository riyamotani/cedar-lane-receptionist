import { DateTime } from 'luxon';
import { SHOP, HOURS, CLOSED_DATES } from '../config/business';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// "4:30", "16:30", or with the caller's own am/pm attached: "4:30 pm".
const TIME_PATTERN = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i;

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

const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4,
  thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7,
};

export interface ResolvedDay {
  day: DateTime;
  // True when the caller named today's weekday ("Thursday" on a Thursday): if that time has
  // already passed today, the caller means next week.
  isTodayByWeekday: boolean;
}

// Turns the day as the caller said it into a shop-local date: "today", "tomorrow", a weekday
// ("thursday", "next thursday") or a calendar date (YYYY-MM-DD). The model only copies the word;
// working out which date a weekday falls on is done here, because models get that wrong.
export function resolveShopDay(text: string, now: DateTime): ResolvedDay | null {
  const said = text.trim().toLowerCase();
  const today = now.setZone(SHOP.timezone).startOf('day');
  if (said === 'today') return { day: today, isTodayByWeekday: false };
  if (said === 'tomorrow') return { day: today.plus({ days: 1 }), isTodayByWeekday: false };

  const match = /^(this |next )?([a-z]+)$/.exec(said);
  const weekday = match ? WEEKDAYS[match[2] ?? ''] : undefined;
  if (weekday) {
    const daysAhead = (weekday - today.weekday + 7) % 7;
    // "next thursday" said on a Thursday can't mean today.
    if (daysAhead === 0 && match?.[1] === 'next ') return { day: today.plus({ days: 7 }), isTodayByWeekday: false };
    return { day: today.plus({ days: daysAhead }), isTodayByWeekday: daysAhead === 0 };
  }

  const day = parseShopDate(said);
  return day ? { day, isTodayByWeekday: false } : null;
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

// Turns what the caller said ("4:30" or "4:30 pm") into a start time, using business hours
// to settle am vs pm when they didn't say. Only checks the start is within opening hours;
// whether the job fits, bay capacity and notice rules are the availability module's job.
export function resolveTime(day: DateTime, time: string): TimeResolution {
  const match = TIME_PATTERN.exec(time.trim());
  if (!match) return { kind: 'invalid' };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
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

const SMALL = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
const DAY_ORDINALS = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth',
  'eighteenth', 'nineteenth', 'twentieth', 'twenty first', 'twenty second', 'twenty third',
  'twenty fourth', 'twenty fifth', 'twenty sixth', 'twenty seventh', 'twenty eighth', 'twenty ninth',
  'thirtieth', 'thirty first',
];

// 1-59 in words: 5 -> "five", 30 -> "thirty", 45 -> "forty five".
function numberWords(n: number): string {
  if (n < 20) return SMALL[n] ?? '';
  const ones = SMALL[n % 10] ?? '';
  return `${TENS[Math.floor(n / 10)] ?? ''}${ones ? ` ${ones}` : ''}`;
}

// The same moment written the way a person says it, for text-to-speech, which reads "4:30"
// as "four three zero": "Thursday, October fifteenth at four thirty PM".
export function formatForSpeech(dt: DateTime): string {
  const local = dt.setZone(SHOP.timezone);
  const hour = numberWords(local.hour % 12 || 12);
  const minute =
    local.minute === 0 ? '' : local.minute < 10 ? ` oh ${numberWords(local.minute)}` : ` ${numberWords(local.minute)}`;
  const day = DAY_ORDINALS[local.day] ?? String(local.day);
  return `${local.toFormat('cccc, LLLL')} ${day} at ${hour}${minute} ${local.toFormat('a')}`;
}
