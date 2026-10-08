import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { SHOP } from '../src/config/business';
import { maxConcurrent, checkSlot, findAlternatives, type Schedule } from '../src/domain/availability';

const at = (iso: string) => DateTime.fromISO(iso, { zone: SHOP.timezone });
const INTERIOR = 90; // Interior Detail & Wash, sedan

// Frozen "now": Monday 12 Oct 2026, 9:00 shop time. Thursday 15 Oct is the test day.
const NOW = at('2026-10-12T09:00');

// The brief's scenario: both bays busy 3:00-4:30 Thursday, so 3:30 is full and 4:30 is open.
const briefSchedule: Schedule = {
  busy: [
    { start: at('2026-10-15T15:00'), end: at('2026-10-15T16:30') },
    { start: at('2026-10-15T15:00'), end: at('2026-10-15T16:30') },
  ],
  blockedDates: new Set(),
  now: NOW,
};
const empty: Schedule = { busy: [], blockedDates: new Set(), now: NOW };

describe('maxConcurrent', () => {
  it('counts back-to-back jobs as never overlapping', () => {
    const busy = [
      { start: at('2026-10-15T09:00'), end: at('2026-10-15T10:00') },
      { start: at('2026-10-15T10:00'), end: at('2026-10-15T11:00') },
    ];
    expect(maxConcurrent(busy, at('2026-10-15T09:00'), at('2026-10-15T11:00'))).toBe(1);
  });

  it('counts jobs that truly overlap', () => {
    const busy = [
      { start: at('2026-10-15T09:00'), end: at('2026-10-15T10:00') },
      { start: at('2026-10-15T09:30'), end: at('2026-10-15T10:30') },
    ];
    expect(maxConcurrent(busy, at('2026-10-15T09:00'), at('2026-10-15T11:00'))).toBe(2);
  });
});

describe('checkSlot', () => {
  it('reports 3:30 as taken and 4:30 as open (brief scenario)', () => {
    expect(checkSlot(at('2026-10-15T15:30'), INTERIOR, briefSchedule)).toBe('taken');
    expect(checkSlot(at('2026-10-15T16:30'), INTERIOR, briefSchedule)).toBe('open');
  });

  it('fits a 2-hour job across two back-to-back jobs when 2 bays exist', () => {
    const schedule: Schedule = {
      ...empty,
      busy: [
        { start: at('2026-10-15T09:00'), end: at('2026-10-15T10:00') },
        { start: at('2026-10-15T10:00'), end: at('2026-10-15T11:00') },
      ],
    };
    expect(checkSlot(at('2026-10-15T09:00'), 120, schedule)).toBe('open');
  });

  it('rejects a job that would run past closing', () => {
    expect(checkSlot(at('2026-10-15T17:00'), INTERIOR, empty)).toBe('outside_hours');
  });

  it('rejects start times off the 30-minute grid', () => {
    expect(checkSlot(at('2026-10-15T15:15'), INTERIOR, empty)).toBe('off_grid');
  });

  it('treats Sundays, holidays and all-day events as closed', () => {
    expect(checkSlot(at('2026-10-18T10:00'), INTERIOR, empty)).toBe('closed'); // Sunday
    expect(checkSlot(at('2026-11-26T10:00'), INTERIOR, empty)).toBe('closed'); // Thanksgiving
    const blocked: Schedule = { ...empty, blockedDates: new Set(['2026-10-15']) };
    expect(checkSlot(at('2026-10-15T10:00'), INTERIOR, blocked)).toBe('closed');
  });

  it('enforces 60 minutes notice exactly at the boundary', () => {
    expect(checkSlot(at('2026-10-12T09:30'), INTERIOR, empty)).toBe('too_soon');
    expect(checkSlot(at('2026-10-12T10:00'), INTERIOR, empty)).toBe('open');
  });

  it('rejects bookings beyond the 60-day horizon', () => {
    expect(checkSlot(at('2026-12-12T10:00'), INTERIOR, empty)).toBe('too_far');
  });
});

describe('findAlternatives', () => {
  it('offers 4:30 first when 3:30 is full (brief scenario)', () => {
    const alternatives = findAlternatives(at('2026-10-15T15:30'), INTERIOR, briefSchedule);
    expect(alternatives.map((t) => t.toFormat('HH:mm'))).toEqual(['16:30', '13:30', '13:00']);
  });

  it('moves to the next open day when the requested day is closed', () => {
    const alternatives = findAlternatives(at('2026-10-18T10:00'), INTERIOR, empty); // Sunday
    expect(alternatives[0]?.toISO()).toBe(at('2026-10-19T08:00').toISO()); // Monday opening
  });
});
