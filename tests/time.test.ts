import { describe, it, expect } from 'vitest';
import { parseShopDate, resolveTime } from '../src/lib/time';

const thursday = parseShopDate('2026-10-15')!;

function resolved(time: string) {
  const r = resolveTime(thursday, time);
  return r.kind === 'ok' ? r.start.toFormat('HH:mm') : r.kind;
}

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
