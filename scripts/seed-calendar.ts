import { DateTime } from 'luxon';
import { calendar } from '../src/google/auth';
import { env } from '../src/config/env';
import { SHOP } from '../src/config/business';
import { createBooking } from '../src/google/calendar';
import { findContact, upsertContact } from '../src/google/sheets';
import { nowInShop, toGoogleIso } from '../src/lib/time';

// Puts known test events on the calendar (the brief asks for this) and matching rows in the
// Contacts tab. Dates are relative to today, and old seed events are removed first, so it can
// be re-run any time.

// Next occurrence of a Luxon weekday (1 = Mon ... 7 = Sun), never today.
function next(weekday: number, from: DateTime): DateTime {
  const days = (weekday - from.weekday + 7) % 7 || 7;
  return from.plus({ days });
}

const at = (day: DateTime, hhmm: string) =>
  DateTime.fromISO(`${day.toFormat('yyyy-MM-dd')}T${hhmm}`, { zone: SHOP.timezone });

async function removeOldSeedEvents(today: DateTime): Promise<number> {
  const res = await calendar.events.list({
    calendarId: env.GOOGLE_CALENDAR_ID,
    timeMin: toGoogleIso(today),
    timeMax: toGoogleIso(today.plus({ days: 90 })),
    privateExtendedProperty: ['source=seed'],
    singleEvents: true,
    maxResults: 250,
  });
  const items = res.data.items ?? [];
  for (const e of items) {
    if (e.id) await calendar.events.delete({ calendarId: env.GOOGLE_CALENDAR_ID, eventId: e.id });
  }
  return items.length;
}

async function main() {
  const today = nowInShop().startOf('day');
  console.log(`Removed ${await removeOldSeedEvents(today)} old seed events`);

  const thursday = next(4, today);
  const friday = thursday.plus({ days: 1 });
  const wednesday = thursday.plus({ days: 6 });

  // Both bays busy 3:00-4:30 Thursday: the brief's "3:30 is full, 4:30 is open" (sedan).
  const thursdayJobs = [
    { name: 'Alex Kim', phone: '+14155550111', vehicle: 'Toyota Camry' },
    { name: 'Jordan Lee', phone: '+14155550122', vehicle: 'Honda Accord' },
  ];
  for (const { name, phone, vehicle } of thursdayJobs) {
    await createBooking({
      serviceId: 'interior_detail_wash',
      serviceName: 'Interior Detail & Wash',
      vehicleSize: 'sedan',
      vehicle,
      name,
      phone,
      price: 150,
      start: at(thursday, '15:00'),
      end: at(thursday, '16:30'),
      source: 'seed',
    });
  }

  // An existing customer booking to test find / reschedule / cancel.
  const mike = { name: 'Mike Torres', phone: '+14155550123', vehicle: 'Tesla Model 3' };
  await createBooking({
    serviceId: 'full_detail',
    serviceName: 'Full Detail',
    vehicleSize: 'sedan',
    ...mike,
    price: 250,
    start: at(friday, '10:00'),
    end: at(friday, '13:00'),
    source: 'seed',
  });

  // Seeded customers get a Contacts row with one booking, as if they had booked through the
  // agent. Only added when missing, so re-running the seed doesn't inflate booking_count.
  let contactsAdded = 0;
  for (const customer of [...thursdayJobs, mike]) {
    if (await findContact(customer.phone)) continue;
    await upsertContact({ ...customer, vehicleSize: 'sedan', booked: true });
    contactsAdded++;
  }
  console.log(`Added ${contactsAdded} contact rows (existing ones left as they are)`);

  // A staff-added all-day closure.
  await calendar.events.insert({
    calendarId: env.GOOGLE_CALENDAR_ID,
    requestBody: {
      summary: 'Staff training – shop closed',
      start: { date: wednesday.toFormat('yyyy-MM-dd') },
      end: { date: wednesday.plus({ days: 1 }).toFormat('yyyy-MM-dd') },
      extendedProperties: { private: { source: 'seed' } },
    },
  });

  console.log(`Thursday ${thursday.toFormat('LLL d')}: two Interior jobs 3:00-4:30 (both bays)`);
  console.log(`Friday ${friday.toFormat('LLL d')}: Mike Torres, Full Detail 10:00-1:00, +14155550123`);
  console.log(`Wednesday ${wednesday.toFormat('LLL d')}: all-day staff training closure`);
}

main().catch((err) => {
  console.error('Seeding FAILED:', err.message);
  process.exit(1);
});
