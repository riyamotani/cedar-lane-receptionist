import type { RegisteredTool } from './define';
import { checkAvailability } from './checkAvailability';
import { bookAppointment } from './bookAppointment';
import { logCall } from './logCall';

// The one list of tools. The chat loop and (in Phase 2) the Vapi webhook both use it.
export const TOOLS: RegisteredTool[] = [checkAvailability, bookAppointment, logCall];

export function findTool(name: string): RegisteredTool | undefined {
  return TOOLS.find((t) => t.name === name);
}
