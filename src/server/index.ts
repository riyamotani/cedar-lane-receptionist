import express from 'express';
import { z } from 'zod';
import { runAgentTurn } from '../agent/loop';
import { getSession } from './sessions';

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

const ChatRequest = z.object({
  sessionId: z.string().min(8).max(100),
  message: z.string().trim().min(1).max(2000),
});

app.post('/chat', async (req, res) => {
  const parsed = ChatRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request.' });
    return;
  }
  const { sessionId, message } = parsed.data;

  // One turn at a time per conversation: overlapping turns would interleave the same history.
  const session = getSession(sessionId);
  if (session.busy) {
    res.status(409).json({ error: 'Still working on your last message.' });
    return;
  }

  session.busy = true;
  try {
    const reply = await runAgentTurn(session.history, message, { sessionId, channel: 'chat' });
    res.json({ reply });
  } catch (err) {
    console.error('[chat] turn failed:', err);
    res.status(502).json({ error: "Sorry, I'm having trouble right now. Please try again in a moment." });
  } finally {
    session.busy = false;
    session.lastActive = Date.now();
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Cedar Lane receptionist running at http://localhost:${port}`));
