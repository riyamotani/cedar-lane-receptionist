import type { ChatHistory } from '../agent/loop';

// Conversations live in memory, keyed by the session id the browser sends. A restart forgets
// them, which is fine: bookings and logs are already in Calendar and Sheets. With more than one
// server instance this would move to Redis or a database.
export interface Session {
  history: ChatHistory;
  busy: boolean; // a turn is in progress
  lastActive: number;
}

const sessions = new Map<string, Session>();
const IDLE_LIMIT_MS = 60 * 60 * 1000;

export function getSession(id: string): Session {
  let session = sessions.get(id);
  if (!session) {
    session = { history: [], busy: false, lastActive: Date.now() };
    sessions.set(id, session);
  }
  return session;
}

// Drop conversations idle for over an hour so memory doesn't grow forever.
// unref(): this timer alone shouldn't keep the process alive.
setInterval(() => {
  const cutoff = Date.now() - IDLE_LIMIT_MS;
  for (const [id, session] of sessions) {
    if (!session.busy && session.lastActive < cutoff) sessions.delete(id);
  }
}, 10 * 60 * 1000).unref();
