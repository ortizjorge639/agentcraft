import { CopilotClient, RuntimeConnection, type CopilotSession, type SessionEvent } from '@github/copilot-sdk';
import { WorkerJob, ToolReply, type WorkerMessage } from './wire.js';
import type { ToolResult } from '../tools.js';
import { sessionConfig } from './configuration.js';

let client: CopilotClient | undefined;
let session: CopilotSession | undefined;
let stopping = false;
const pending = new Map<string, { resolve(value: ToolResult): void; reject(reason: Error): void }>();

function send(message: WorkerMessage) {
  if (process.connected) process.send?.(message);
}

async function stop() {
  if (stopping) return;
  stopping = true;
  for (const waiter of pending.values()) waiter.reject(new Error('AgentCraft turn stopped'));
  pending.clear();
  try {
    if (session) await session.abort();
    if (client) {
      if (session) await client.rpc.sessions.save({ sessionId: session.sessionId });
      const errors = await client.stop();
      if (errors.length) throw new Error(errors.map((e) => e.message).join('; '));
    }
  } catch (e) {
    send({ type: 'error', message: `Copilot shutdown failed: ${String(e)}` });
    await client?.forceStop();
    process.exitCode = 1;
  } finally {
    process.disconnect?.();
  }
}

function event(e: SessionEvent) {
  if (stopping || e.agentId) return;
  switch (e.type) {
    case 'assistant.turn_start': send({ type: 'event', event: { kind: 'turn' } }); break;
    case 'assistant.message': send({ type: 'event', event: { kind: 'text', text: e.data.content } }); break;
    case 'tool.execution_start': {
      const input = e.data.arguments;
      send({ type: 'event', event: {
        kind: 'tool', name: e.data.toolName, id: e.data.toolCallId,
        input: input && typeof input === 'object' && !Array.isArray(input) ? input : {},
      } });
      break;
    }
    case 'tool.execution_complete':
      send({ type: 'event', event: {
        kind: 'result', id: e.data.toolCallId, success: e.data.success,
        text: e.data.result?.content ?? e.data.error?.message ?? '',
      } });
      break;
    case 'session.error': send({ type: 'event', event: { kind: 'error', text: e.data.message } }); break;
  }
}

async function run(job: WorkerJob) {
  client = new CopilotClient({
    mode: 'empty', baseDirectory: job.home, workingDirectory: job.cwd, logLevel: 'error',
    connection: RuntimeConnection.forStdio({ ...(job.cliPath ? { path: job.cliPath } : {}) }),
  });
  try {
    await client.start();
    if (job.mode === 'probe') {
      const auth = await client.getAuthStatus();
      const status = await client.getStatus();
      const models = auth.isAuthenticated ? (await client.listModels()).map((m) => m.id) : [];
      send({ type: 'auth', authenticated: auth.isAuthenticated, version: status.version, protocol: status.protocolVersion, models });
      return;
    }
    const config = sessionConfig(job, event, (name, args, sessionId, id) => new Promise((resolve, reject) => {
      if (stopping) { reject(new Error('turn stopped')); return; }
      if (pending.has(id)) { reject(new Error('duplicate pending tool call')); return; }
      pending.set(id, { resolve, reject });
      send({ type: 'tool', id, sessionId, name, args });
    }));
    session = job.resume ? await client.resumeSession(job.resume, config) : await client.createSession(config);
    await session.log('AgentCraft host session initialized.');
    await client.rpc.sessions.save({ sessionId: session.sessionId });
    send({ type: 'session', id: session.sessionId });
    const response = await session.sendAndWait(job.prompt, 45 * 60_000);
    if (!stopping) send({ type: 'done', ...(response ? { text: response.data.content } : {}) });
  } catch (e) {
    if (!stopping) {
      send({ type: 'error', message: String(e) });
      process.exitCode = 1;
    }
  } finally {
    await stop();
  }
}

let started = false;
process.on('message', (message: unknown) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'stop') {
    void stop();
    return;
  }
  const reply = ToolReply.safeParse(message);
  if (reply.success) {
    const waiter = pending.get(reply.data.id);
    if (!waiter) { send({ type: 'error', message: 'Unexpected tool result' }); return; }
    pending.delete(reply.data.id);
    waiter.resolve(reply.data.result);
    return;
  }
  if (started) { send({ type: 'error', message: 'Invalid worker message' }); return; }
  const job = WorkerJob.safeParse(message);
  if (!job.success) { send({ type: 'error', message: `Invalid worker job: ${job.error.message}` }); void stop(); return; }
  started = true;
  void run(job.data);
});
process.on('disconnect', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
