import { z } from 'zod';

// Every tool returns one of these to the LLM, never throws at it.
export type ToolFailure = { ok: false; error: string; message: string } & Record<string, unknown>;
export type ToolSuccess = { ok: true } & Record<string, unknown>;
export type ToolResult = ToolSuccess | ToolFailure;

export function fail(error: string, message: string, extra: Record<string, unknown> = {}): ToolFailure {
  return { ok: false, error, message, ...extra };
}

// Which conversation a tool call belongs to, so tools can log to the right CallLog row.
export interface ToolContext {
  sessionId: string;
  channel: 'chat' | 'voice';
}

// What the agent loop (and later the Vapi webhook) sees: a name, a description, the JSON
// Schema to show the LLM, and run() which takes raw, untrusted arguments.
export interface RegisteredTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(rawArgs: unknown, ctx: ToolContext): Promise<ToolResult>;
}

// One zod schema does two jobs: it becomes the JSON Schema the LLM is shown, and it
// validates whatever the LLM actually sends before the handler runs.
export function defineTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  schema: S;
  handler: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>;
}): RegisteredTool {
  const { $schema: _unused, ...parameters } = z.toJSONSchema(def.schema) as Record<string, unknown>;
  return {
    name: def.name,
    description: def.description,
    parameters,
    async run(rawArgs, ctx) {
      const parsed = def.schema.safeParse(rawArgs);
      if (!parsed.success) {
        return fail('invalid_arguments', z.prettifyError(parsed.error));
      }
      try {
        return await def.handler(parsed.data, ctx);
      } catch (err) {
        // Google still failing after the retry, or a bug. The agent apologises and offers a callback.
        console.error(`[tool ${def.name}] failed:`, err);
        return fail('upstream_error', 'A system error occurred. Apologise and offer a callback from the team.');
      }
    },
  };
}
