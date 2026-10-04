import { z } from 'zod';

export const ToolOutput = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  isError: z.boolean().optional(),
});

export const WorkerJob = z.object({
  mode: z.enum(['probe', 'run']),
  home: z.string(), cwd: z.string(), cliPath: z.string().optional(),
  models: z.array(z.string()).default([]),
  model: z.string().optional(), resume: z.string().optional(),
  prompt: z.string().default(''), systemPrompt: z.string().default(''),
  maxTurns: z.number().int().positive().default(80),
  tools: z.array(z.object({
    name: z.string(), description: z.string(), parameters: z.record(z.string(), z.unknown()),
  })).default([]),
});
export type WorkerJob = z.infer<typeof WorkerJob>;

export const WorkerEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('tool'), name: z.string(), id: z.string(), input: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal('result'), id: z.string(), text: z.string(), success: z.boolean() }),
  z.object({ kind: z.literal('error'), text: z.string() }),
  z.object({ kind: z.literal('turn') }),
]);
export type WorkerEvent = z.infer<typeof WorkerEvent>;

export const WorkerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), id: z.string() }),
  z.object({ type: z.literal('event'), event: WorkerEvent }),
  z.object({ type: z.literal('tool'), id: z.string(), sessionId: z.string(), name: z.string(), args: z.unknown() }),
  z.object({ type: z.literal('auth'), authenticated: z.boolean(), version: z.string(), protocol: z.number(), models: z.array(z.string()) }),
  z.object({ type: z.literal('done'), text: z.string().optional() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type WorkerMessage = z.infer<typeof WorkerMessage>;
export const ToolReply = z.object({ type: z.literal('tool_result'), id: z.string(), result: ToolOutput });
