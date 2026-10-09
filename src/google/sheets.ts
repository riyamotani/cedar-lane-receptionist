import { sheets } from './auth';
import { env } from '../config/env';
import { withRetry } from '../lib/retry';
import { nowInShop } from '../lib/time';

// The only module that talks to Google Sheets. Rows are handled as { header: value } objects
// so code never depends on column positions.

export const CONTACTS_TAB = 'Contacts';
export const CALL_LOG_TAB = 'CallLog';

export const CONTACT_HEADERS = [
  'phone', 'name', 'vehicle', 'vehicle_size', 'first_seen', 'last_seen', 'booking_count', 'notes',
];
export const CALL_LOG_HEADERS = [
  'timestamp', 'session_id', 'channel', 'phone', 'name', 'intents', 'summary',
  'outcome', 'event_id', 'handoff_reason', 'callback_by', 'status',
];

type Row = Record<string, string>;
const spreadsheetId = env.GOOGLE_SHEET_ID;
const stamp = () => nowInShop().toFormat('yyyy-MM-dd HH:mm'); // shop-local, readable for staff

const toRow = (headers: string[], values: string[]): Row =>
  Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
const toValues = (headers: string[], row: Row): string[] => headers.map((h) => row[h] ?? '');

// Whole tab, including the header row. Fine for a shop with ~30 calls a day; a bigger
// business would use a database rather than scanning a sheet.
async function readRows(tab: string): Promise<string[][]> {
  const res = await withRetry(() => sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A:Z` }));
  return (res.data.values ?? []) as string[][];
}

// Rewriting a known row is idempotent, so it's safe to retry.
async function writeRow(tab: string, rowNumber: number, values: string[]): Promise<void> {
  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A${rowNumber}`,
      valueInputOption: 'RAW', // stored as plain text: no formula injection, no auto-converted dates
      requestBody: { values: [values] },
    }),
  );
}

// Not retried: if the response is lost after the row was added, a retry would add it twice.
async function appendRow(tab: string, values: string[]): Promise<void> {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
}

// Finds the data row whose `column` equals `value`; returns its 1-based sheet row number.
function findRow(rows: string[][], headers: string[], column: string, value: string) {
  const col = headers.indexOf(column);
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    if (values && values[col] === value) return { rowNumber: i + 1, row: toRow(headers, values) };
  }
  return null;
}

export interface ContactUpdate {
  phone: string; // E.164, the key
  name?: string;
  vehicle?: string;
  vehicleSize?: string;
  booked: boolean;
}

// One row per phone number. The name becomes the most recent one used (shared family phones);
// each Calendar booking keeps its own name. Staff-owned notes are never overwritten.
export async function upsertContact(u: ContactUpdate): Promise<void> {
  const now = stamp();
  const found = findRow(await readRows(CONTACTS_TAB), CONTACT_HEADERS, 'phone', u.phone);
  if (!found) {
    await appendRow(CONTACTS_TAB, toValues(CONTACT_HEADERS, {
      phone: u.phone,
      name: u.name ?? '',
      vehicle: u.vehicle ?? '',
      vehicle_size: u.vehicleSize ?? '',
      first_seen: now,
      last_seen: now,
      booking_count: u.booked ? '1' : '0',
    }));
    return;
  }
  const row = found.row;
  row.name = u.name || row.name || '';
  row.vehicle = u.vehicle || row.vehicle || '';
  row.vehicle_size = u.vehicleSize || row.vehicle_size || '';
  row.last_seen = now;
  row.booking_count = String(Number(row.booking_count || 0) + (u.booked ? 1 : 0));
  await writeRow(CONTACTS_TAB, found.rowNumber, toValues(CONTACT_HEADERS, row));
}

export interface CallLogUpdate {
  phone?: string;
  name?: string;
  intents?: string[];
  summary?: string;
  outcome?: string;
  eventId?: string;
  handoffReason?: string;
  callbackBy?: string;
  status?: string;
}

// One row per conversation, created by the first event and updated by later ones, so a
// booking is logged even if the chat is abandoned before log_call.
export async function upsertCallLog(sessionId: string, channel: string, u: CallLogUpdate): Promise<void> {
  const found = findRow(await readRows(CALL_LOG_TAB), CALL_LOG_HEADERS, 'session_id', sessionId);
  const row: Row = found?.row ?? { timestamp: stamp(), session_id: sessionId, channel };

  const merge = (key: string, value?: string) => {
    if (value) row[key] = value;
  };
  // Lists (several intents, or several bookings in one call) accumulate instead of overwriting.
  const addToList = (key: string, values: string[]) => {
    const items = new Set((row[key] ?? '').split(', ').filter(Boolean));
    values.forEach((v) => items.add(v));
    row[key] = [...items].join(', ');
  };

  merge('phone', u.phone);
  merge('name', u.name);
  merge('summary', u.summary);
  merge('outcome', u.outcome);
  merge('handoff_reason', u.handoffReason);
  merge('callback_by', u.callbackBy);
  merge('status', u.status);
  if (u.intents) addToList('intents', u.intents);
  if (u.eventId) addToList('event_id', [u.eventId]);
  if (!row.outcome) row.outcome = 'info_only'; // action tools (booking, handoff) set the real outcome

  const values = toValues(CALL_LOG_HEADERS, row);
  if (found) await writeRow(CALL_LOG_TAB, found.rowNumber, values);
  else await appendRow(CALL_LOG_TAB, values);
}

export interface InteractionUpdate extends CallLogUpdate {
  vehicle?: string;
  vehicleSize?: string;
  booked?: boolean;
}

// The single entry point tools use. Updates this conversation's CallLog row and, whenever we
// know the caller's phone (E.164), their Contacts row too: the brief asks for a row per caller,
// not just per customer who booked.
export async function recordInteraction(sessionId: string, channel: string, u: InteractionUpdate): Promise<void> {
  await upsertCallLog(sessionId, channel, u);
  if (u.phone) {
    await upsertContact({
      phone: u.phone,
      name: u.name,
      vehicle: u.vehicle,
      vehicleSize: u.vehicleSize,
      booked: u.booked ?? false,
    });
  }
}
