import { sheets } from '../src/google/auth';
import { env } from '../src/config/env';
import { CALL_LOG_HEADERS, CALL_LOG_TAB, CONTACT_HEADERS, CONTACTS_TAB } from '../src/google/sheets';

// Creates the Contacts and CallLog tabs (if missing) and writes their header rows.
// Safe to re-run: it only ever touches row 1, never data rows.
const spreadsheetId = env.GOOGLE_SHEET_ID;
const TABS = [
  { title: CONTACTS_TAB, headers: CONTACT_HEADERS },
  { title: CALL_LOG_TAB, headers: CALL_LOG_HEADERS },
];

async function main() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title));

  const missing = TABS.filter((t) => !existing.has(t.title));
  if (missing.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missing.map((t) => ({
          addSheet: { properties: { title: t.title, gridProperties: { frozenRowCount: 1 } } },
        })),
      },
    });
  }

  for (const t of TABS) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${t.title}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [t.headers] },
    });
  }
  console.log(`Created: ${missing.map((t) => t.title).join(', ') || 'nothing (tabs already exist)'}`);
  console.log('Header rows written for Contacts and CallLog.');
}

main().catch((err) => {
  console.error('Sheet setup FAILED:', err.message);
  process.exit(1);
});
