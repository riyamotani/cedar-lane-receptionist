import type { DateTime } from 'luxon';
import { SHOP } from '../config/business';
import { openingHours } from '../lib/time';

export interface CallbackPromise {
  by: DateTime;
  text: string; // what the agent tells the caller, e.g. "within 2 hours"
}

// "Within 2 hours" only if the shop is open now and stays open for the whole window; otherwise
// the next opening time, so we never promise a call while nobody is there to make it.
// Uses configured hours and holidays (staff all-day calendar closures aren't checked here).
export function callbackPromise(now: DateTime): CallbackPromise {
  const local = now.setZone(SHOP.timezone);
  const window = { hours: SHOP.callbackWithinBusinessHours };

  const today = openingHours(local);
  if (today && local >= today.open && local.plus(window) <= today.close) {
    return { by: local.plus(window), text: `within ${SHOP.callbackWithinBusinessHours} hours` };
  }

  for (let i = 0; i <= 14; i++) {
    const hours = openingHours(local.startOf('day').plus({ days: i }));
    if (hours && hours.open > local) {
      const day = i === 0 ? 'this morning' : i === 1 ? 'tomorrow morning' : `${hours.open.toFormat('cccc')} morning`;
      return { by: hours.open, text: `first thing ${day}, around ${hours.open.toFormat('h:mm a')}` };
    }
  }
  throw new Error('No opening found in the next 14 days; check HOURS in config');
}
