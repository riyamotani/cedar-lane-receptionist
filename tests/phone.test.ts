import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../src/lib/phone';

describe('normalizePhone', () => {
  it('normalizes common US formats to E.164', () => {
    expect(normalizePhone('415-555-0190')).toBe('+14155550190');
    expect(normalizePhone('(415) 555 0190')).toBe('+14155550190');
    expect(normalizePhone('+1 415.555.0190')).toBe('+14155550190');
  });

  it('rejects incomplete, international and impossible numbers', () => {
    expect(normalizePhone('415-555-019')).toBeNull();
    expect(normalizePhone('+44 20 7946 0958')).toBeNull();
    expect(normalizePhone('015-555-0190')).toBeNull();
  });
});
