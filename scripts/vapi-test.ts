import { required } from '../src/config/env';
import { nowInShop } from '../src/lib/time';

// Sends our webhook the same kind of request Vapi sends, without placing a call (so it costs
// no credit). Needs `npm run dev` running in another terminal. Uses check_availability only,
// which reads the Calendar and changes nothing.
const url = `http://localhost:${process.env.PORT ?? 3000}/vapi`;
const secret = required('VAPI_WEBHOOK_SECRET');

// Next Thursday, the seeded "both bays busy 3:00-4:30" day.
const today = nowInShop().startOf('day');
const thursday = today.plus({ days: (4 - today.weekday + 7) % 7 || 7 }).toFormat('yyyy-MM-dd');
const args = { service_id: 'interior_detail_wash', vehicle_size: 'sedan', date: thursday, time: '3:30' };

async function post(label: string, body: unknown, headerSecret = secret) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-vapi-secret': headerSecret },
    body: JSON.stringify(body),
  });
  console.log(`\n${label}\n  HTTP ${res.status}\n  ${await res.text()}`);
}

const call = { id: 'test-call-0001' };

// The two tool-call shapes Vapi's docs show; the webhook must handle both.
await post('1. tool call, {name, parameters} shape (expect status "taken" and 4:30 offered)', {
  message: { type: 'tool-calls', call, toolCallList: [{ id: 'tc_1', name: 'check_availability', parameters: args }] },
});
await post('2. tool call, {function: {name, arguments-as-string}} shape (expect the same result)', {
  message: {
    type: 'tool-calls',
    call,
    toolCallList: [{ id: 'tc_2', type: 'function', function: { name: 'check_availability', arguments: JSON.stringify(args) } }],
  },
});
await post('3. bad argument (expect HTTP 200 with an invalid_arguments result, not a crash)', {
  message: { type: 'tool-calls', call, toolCallList: [{ id: 'tc_3', name: 'check_availability', parameters: { ...args, time: 'half past three' } }] },
});
await post('4. wrong secret (expect HTTP 401)', { message: { type: 'tool-calls', call, toolCallList: [] } }, 'not-the-secret');
