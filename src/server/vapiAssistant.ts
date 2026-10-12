import { buildSystemPrompt } from '../agent/prompt';
import { SHOP } from '../config/business';
import { nowInShop } from '../lib/time';
import { TOOLS } from '../tools';
import { VOICE_EXCLUDED_TOOLS } from './vapi';

// The Vapi assistant is generated from the code (prompt, tool list, settings) and pushed with
// `npm run vapi:sync`, so the dashboard never becomes a second source of truth.

export const ASSISTANT_NAME = 'Cedar Lane Receptionist';

// Spoken while a tool runs, so the caller hears something instead of silence during the
// Calendar/Sheets round trip. This is the brief's "Let me check..." moment.
const SAID_WHILE_WORKING: Record<string, string> = {
  check_availability: 'Let me check.',
  book_appointment: 'One moment, booking that now.',
  find_appointments: 'Let me pull that up.',
  reschedule_appointment: 'One moment while I move that.',
  cancel_appointment: 'One moment.',
  report_running_late: 'Okay, one sec.',
  request_human_handoff: 'One moment.',
};

export function buildAssistant(publicUrl: string, webhookSecret: string) {
  const server = {
    url: `${publicUrl.replace(/\/$/, '')}/vapi`,
    headers: { 'x-vapi-secret': webhookSecret },
    timeoutSeconds: 20,
  };

  const tools = TOOLS.filter((t) => !VOICE_EXCLUDED_TOOLS.includes(t.name)).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
    server,
    messages: [{ type: 'request-start', content: SAID_WHILE_WORKING[t.name] ?? 'One moment.' }],
  }));

  return {
    name: ASSISTANT_NAME,
    firstMessage: `Thanks for calling ${SHOP.name}, how can I help?`,
    model: {
      provider: 'openai',
      // Non-reasoning model: no "thinking" pause before each reply, which matters for the
      // ~1.2 second response target.
      model: 'gpt-4.1-mini',
      temperature: 0.3,
      maxTokens: 250,
      // The date table inside the prompt is fixed at sync time: re-sync at the start of each day.
      messages: [{ role: 'system', content: buildSystemPrompt(nowInShop(), 'voice') }],
      tools,
    },
    voice: {
      provider: 'deepgram',
      voiceId: 'asteria',
      // Vapi's text formatting is off. Its pipeline replaces every colon with a period before
      // anything else, so "3:30" became "3.30" and was read digit by digit ("three three zero").
      // Individual steps can't be disabled and custom replacements run last (after the colon is
      // already gone), so the whole plan is off and the voice gets the model's text as written.
      // The prompt covers what the formatter used to do: prices in words, phone numbers as digits.
      chunkPlan: { formatPlan: { enabled: false } },
    },
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'en' },
    server,
    // Only the two events we handle, so Vapi doesn't send a webhook for every transcript update.
    serverMessages: ['tool-calls', 'end-of-call-report'],
    // Caps a forgotten open call so it can't drain the trial credit.
    maxDurationSeconds: 240,
    backgroundSound: 'off',
  };
}
