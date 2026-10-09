import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { SHOP } from '../src/config/business';
import { callbackPromise } from '../src/domain/callback';

const at = (iso: string) => DateTime.fromISO(iso, { zone: SHOP.timezone });
const by = (iso: string) => callbackPromise(at(iso)).by.toFormat('ccc yyyy-MM-dd HH:mm');

describe('callbackPromise', () => {
  it('promises within 2 hours when open for the whole window', () => {
    expect(callbackPromise(at('2026-10-15T10:00')).text).toBe('within 2 hours');
    expect(by('2026-10-15T10:00')).toBe('Thu 2026-10-15 12:00');
  });

  it('rolls to the next morning when fewer than 2 hours are left before closing', () => {
    expect(by('2026-10-15T16:30')).toBe('Fri 2026-10-16 08:00');
    expect(callbackPromise(at('2026-10-15T16:30')).text).toContain('tomorrow morning');
  });

  it('uses this morning when called before opening', () => {
    expect(by('2026-10-15T07:00')).toBe('Thu 2026-10-15 08:00');
    expect(callbackPromise(at('2026-10-15T07:00')).text).toContain('this morning');
  });

  it('skips Sunday and holidays', () => {
    expect(by('2026-10-17T17:00')).toBe('Mon 2026-10-19 08:00'); // Saturday evening -> Monday
    expect(by('2026-11-25T17:00')).toBe('Fri 2026-11-27 08:00'); // Thanksgiving Thursday is closed
  });
});
