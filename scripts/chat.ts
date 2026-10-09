import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { runAgentTurn, type ChatHistory } from '../src/agent/loop';

// Terminal chat for testing the agent before the web UI exists.
const rl = readline.createInterface({ input, output });
const history: ChatHistory = [];
console.log('Cedar Lane receptionist. Type "exit" to quit.\n');

while (true) {
  const text = (await rl.question('You: ')).trim();
  if (text === 'exit') break;
  if (!text) continue;
  try {
    console.log(`Agent: ${await runAgentTurn(history, text)}\n`);
  } catch (err) {
    console.error('Error:', (err as Error).message);
  }
}
rl.close();
