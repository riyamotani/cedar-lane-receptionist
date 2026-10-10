import { appendFile, mkdir } from 'node:fs/promises';
import { nowInShop } from './time';

// Prints to the terminal and also appends to logs/agent.log, so the record of what the agent
// did survives a cleared terminal or a restart. The file holds caller names and numbers, so it
// stays local (*.log is gitignored).
const LOG_DIR = 'logs';
const LOG_FILE = `${LOG_DIR}/agent.log`;

// Writes are chained so lines land in the file in the order they were logged.
let writes: Promise<unknown> = mkdir(LOG_DIR, { recursive: true });

// echo=false writes to the file only (used for the conversation text, which the terminal chat
// already shows on screen).
export function logEvent(sessionId: string, text: string, echo = true): void {
  if (echo) console.log(text);
  const line = `${nowInShop().toFormat('yyyy-MM-dd HH:mm:ss')} [${sessionId.slice(0, 8)}] ${text.trim()}\n`;
  writes = writes
    .then(() => appendFile(LOG_FILE, line))
    .catch((err) => console.error('[log] could not write to file:', (err as Error).message));
}
