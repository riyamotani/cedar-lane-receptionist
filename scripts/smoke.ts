import { calendar, sheets } from '../src/google/auth';
import { env } from '../src/config/env';

async function main() {
  const events = await calendar.events.list({
    calendarId: env.GOOGLE_CALENDAR_ID,
    timeMin: new Date().toISOString(),
    maxResults: 5,
    singleEvents: true,
    orderBy: 'startTime',
  });
  const items = events.data.items ?? [];
  console.log(`Calendar OK: ${items.length} upcoming events`);
  for (const e of items) {
    console.log(`  - ${e.start?.dateTime ?? e.start?.date} ${e.summary}`);
  }

  const marker = `smoke test ${new Date().toISOString()}`;
  // Explicit tab: an unqualified 'A1' means "first tab", which could be Contacts' header row.
  await sheets.spreadsheets.values.update({
    spreadsheetId: env.GOOGLE_SHEET_ID,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [[marker]] },
  });
  const read = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEET_ID,
    range: 'Sheet1!A1',
  });
  const value = read.data.values?.[0]?.[0];
  if (value !== marker) {
    throw new Error(`Sheet read-back mismatch: wrote "${marker}", got "${value}"`);
  }
  console.log('Sheet OK: wrote and read back A1');
}

main().catch((err) => {
  console.error('Smoke test FAILED:', err.message);
  process.exit(1);
});
