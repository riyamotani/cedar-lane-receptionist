import type { DateTime } from 'luxon';
import { z } from 'zod';
import { checkSlot, findAlternatives, openSlotsOnDay } from '../domain/availability';
import { nowInShop, parseShopDate, resolveTime } from '../lib/time';
import { defineTool, fail } from './define';
import { STATUS_MESSAGES, fields, hoursText, resolveService, scheduleAround, slotView } from './common';

export const checkAvailability = defineTool({
  name: 'check_availability',
  description:
    'Check whether a time is open for a service, or list the open times on a day (omit time). ' +
    'Always call this before telling the caller a time is open or full.',
  schema: z.object({
    service_id: fields.service_id,
    vehicle_size: fields.vehicle_size,
    date: fields.date,
    time: fields.time.optional(),
  }),
  async handler({ service_id, vehicle_size, date, time }) {
    const svc = resolveService(service_id, vehicle_size);
    if (!svc.ok) return svc;
    const day = parseShopDate(date);
    if (!day) return fail('invalid_date', 'Date must be a real date in YYYY-MM-DD format.');

    const schedule = await scheduleAround(day, nowInShop());
    const details = { service: svc.service.name, vehicle_size, price: svc.price, duration_minutes: svc.minutes };
    const alternativesFrom = (from: DateTime) =>
      findAlternatives(from, svc.minutes, schedule).map(slotView);

    // Closed days first, so "Sunday at 10" says "closed", not "outside hours".
    const hours = hoursText(day, schedule);
    if (!hours) {
      return { ok: true, ...details, status: 'closed', message: STATUS_MESSAGES.closed, alternatives: alternativesFrom(day) };
    }

    // No time given: list the day's open times (or the next openings if there are none).
    if (!time) {
      const open = openSlotsOnDay(day, svc.minutes, schedule).map(slotView);
      return { ok: true, ...details, day: day.toFormat('cccc, LLL d'), open_times: open, alternatives: open.length ? [] : alternativesFrom(day) };
    }

    const resolved = resolveTime(day, time);
    if (resolved.kind === 'invalid') return fail('invalid_time', `Got "${time}", which is not a real time. Use H:mm, e.g. '4:30'.`);
    if (resolved.kind === 'ambiguous') {
      return { ok: true, status: 'ambiguous', message: 'Both morning and evening are possible. Ask which one.', options: resolved.options.map(slotView) };
    }
    if (resolved.kind === 'outside_hours') {
      const message = `That's outside opening hours. That day we're open ${hours}, and the job has to finish by closing.`;
      return { ok: true, ...details, status: 'outside_hours', message, alternatives: alternativesFrom(day) };
    }

    const status = checkSlot(resolved.start, svc.minutes, schedule);
    return {
      ok: true,
      ...details,
      status,
      message: STATUS_MESSAGES[status],
      requested: slotView(resolved.start),
      alternatives: status === 'open' ? [] : alternativesFrom(resolved.start),
    };
  },
});
