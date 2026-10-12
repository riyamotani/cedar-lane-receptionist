import OpenAI from 'openai';
import { env } from '../config/env';

// One client for every LLM call we make ourselves (the chat loop and call summaries).
export const llm = new OpenAI({ apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL });
