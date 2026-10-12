import { required } from '../src/config/env';
import { ASSISTANT_NAME, buildAssistant } from '../src/server/vapiAssistant';

// Creates the Vapi assistant, or updates it if one with our name already exists.
// Run at the start of each testing day (the prompt's date table is fixed at sync time) and
// whenever the prompt, tools or tunnel URL change.
const API = 'https://api.vapi.ai';
const headers = {
  Authorization: `Bearer ${required('VAPI_API_KEY')}`,
  'Content-Type': 'application/json',
};

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const assistant = buildAssistant(required('PUBLIC_URL'), required('VAPI_WEBHOOK_SECRET'));

  const existing = (await call('GET', '/assistant')) as { id: string; name?: string }[];
  const match = existing.find((a) => a.name === ASSISTANT_NAME);

  const saved = (match
    ? await call('PATCH', `/assistant/${match.id}`, assistant)
    : await call('POST', '/assistant', assistant)) as { id: string };

  console.log(`${match ? 'Updated' : 'Created'} assistant "${ASSISTANT_NAME}" (${saved.id})`);

  // Read it back from Vapi, so we see what is actually stored (the dashboard can show a stale
  // page or an older draft).
  const stored = (await call('GET', `/assistant/${saved.id}`)) as {
    model?: { messages?: { content?: string }[] };
  };
  const prompt = stored.model?.messages?.[0]?.content ?? '';
  console.log(`Stored prompt says: ${prompt.split('\n').find((line) => line.startsWith('Right now')) ?? '(date line not found)'}`);
  console.log(`Webhook: ${assistant.server.url}`);
  console.log(`Tools: ${assistant.model.tools.map((t) => t.function.name).join(', ')}`);
}

main().catch((err) => {
  console.error('Vapi sync FAILED:', err.message);
  process.exit(1);
});
