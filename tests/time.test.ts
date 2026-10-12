import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { SHOP } from '../src/config/business';
import { formatForSpeech, parseShopDate, resolveShopDay, resolveTime } from '../src/lib/time';

const thursday = parseShopDate('2026-10-15')!;

function resolved(time: string) {
  const r = resolveTime(thursday, time);
  return r.kind === 'ok' ? r.start.toFormat('HH:mm') : r.kind;
}

describe('formatForSpeech (text-to-speech wording)', () => {
  const at = (time: string) => formatForSpeech(DateTime.fromISO(`2026-10-15T${time}`, { zone: SHOP.timezone }));

  it('writes dates and times in words, with no digits or colons', () => {
    expect(at('16:30')).toBe('Thursday, October fifteenth at four thirty PM');
    expect(at('10:00')).toBe('Thursday, October fifteenth at ten AM');
    expect(at('12:00')).toBe('Thursday, October fifteenth at twelve PM');
    expect(at('13:45')).toBe('Thursday, October fifteenth at one forty five PM');
    expect(at('09:05')).toBe('Thursday, October fifteenth at nine oh five AM');
  });
});

describe('resolveShopDay (the day as the caller said it)', () => {
  // Frozen "now": Sunday 11 Oct 2026, 5:22 AM shop time, the moment the voice model sent
  // Wednesday's date for "Thursday".
  const sunday = DateTime.fromISO('2026-10-11T05:22', { zone: SHOP.timezone });
  const day = (text: string, now = sunday) => resolveShopDay(text, now)?.day.toFormat('ccc yyyy-MM-dd') ?? null;

  it('turns a weekday into the next date it falls on', () => {
    expect(day('thursday')).toBe('Thu 2026-10-15');
    expect(day('Thursday')).toBe('Thu 2026-10-15');
    expect(day('next thursday')).toBe('Thu 2026-10-15');
    expect(day('monday')).toBe('Mon 2026-10-12');
  });

  it('handles today, tomorrow and calendar dates', () => {
    expect(day('today')).toBe('Sun 2026-10-11');
    expect(day('tomorrow')).toBe('Mon 2026-10-12');
    expect(day('2026-10-15')).toBe('Thu 2026-10-15');
  });

  it("flags today's weekday, and reads 'next' as the week after", () => {
    const thursdayMorning = DateTime.fromISO('2026-10-15T10:00', { zone: SHOP.timezone });
    expect(resolveShopDay('thursday', thursdayMorning)).toMatchObject({ isTodayByWeekday: true });
    expect(day('thursday', thursdayMorning)).toBe('Thu 2026-10-15');
    expect(day('next thursday', thursdayMorning)).toBe('Thu 2026-10-22');
  });

  it('rejects anything else', () => {
    expect(day('someday')).toBeNull();
    expect(day('2026-02-30')).toBeNull();
  });
});

describe('parseShopDate', () => {
  it('rejects impossible and malformed dates', () => {
    expect(parseShopDate('2026-02-30')).toBeNull();
    expect(parseShopDate('15/10/2026')).toBeNull();
  });
});

describe('resolveTime (am/pm from business hours)', () => {
  it('picks the only reading inside 8:00-18:00', () => {
    expect(resolved('3:30')).toBe('15:30');
    expect(resolved('4:30')).toBe('16:30');
    expect(resolved('9:00')).toBe('09:00');
    expect(resolved('12:00')).toBe('12:00');
  });

  it('passes unambiguous 24-hour times through', () => {
    expect(resolved('16:30')).toBe('16:30');
  });

  it("respects the caller's own am/pm, in any case or spacing", () => {
    expect(resolved('4:30 pm')).toBe('16:30');
    expect(resolved('4:30PM')).toBe('16:30');
    expect(resolved('4:30 am')).toBe('outside_hours');
  });

  it('reports times where neither reading is open', () => {
    expect(resolved('7:00')).toBe('outside_hours');
  });

  it('rejects malformed input', () => {
    expect(resolved('4.30')).toBe('invalid');
    expect(resolved('3:30}')).toBe('invalid');
    expect(resolved('25:00')).toBe('invalid');
    expect(resolved('13:00 pm')).toBe('invalid');
  });
});
