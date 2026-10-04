import { CopilotClient, RuntimeConnection, type SessionEvent } from '@github/copilot-sdk';
import { expect, it } from 'vitest';
import { sessionConfig } from '../src/agents/copilot/configuration.js';
import { copilotEnv } from '../src/agents/copilot/runtime.js';
import type { WorkerJob } from '../src/agents/copilot/wire.js';
import { tempDir, rmrf } from './helpers.js';

it.skipIf(process.env.AGENTCRAFT_SDK_SMOKE !== '1')('round-trips only host tools and propagates failures through the actual SDK without inference', async () => {
  const home = tempDir();
  const events: SessionEvent[] = [];
  const client = new CopilotClient({
    mode: 'empty', baseDirectory: home, workingDirectory: home,
    connection: RuntimeConnection.forStdio(),
    env: copilotEnv(process.env, home, 'kit'), logLevel: 'error',
  });
  const job: WorkerJob = {
    mode: 'run', home, cwd: home, prompt: '', systemPrompt: 'Use only the host tools.', maxTurns: 1, models: [],
    tools: [{ name: 'agentcraft_echo', description: 'Echo a test value.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
  };
  try {
    const config = sessionConfig(job, (e) => events.push(e), async (_name, args) => {
      const input = args && typeof args === 'object' && 'text' in args ? String(args.text) : 'invalid';
      return { content: [{ type: 'text', text: `received: ${input}` }] };
    });
    const session = await client.createSession(config);
    await session.log('Host contract smoke; no inference requested.');
    await session.rpc.tools.initializeAndValidate();
    const metadata = await session.rpc.tools.getCurrentMetadata();
    expect(metadata.tools?.map((t) => t.name)).toEqual(['agentcraft_echo']);
    const result = await session.rpc.tools.execute({ name: 'agentcraft_echo', arguments: { text: 'hello' } });
    expect(JSON.stringify(result)).toContain('received: hello');
    const forbidden = await session.rpc.tools.execute({ name: 'bash', arguments: { command: 'echo unapproved' } });
    expect(forbidden).toMatchObject({ resultType: 'failure' });
    await session.disconnect();
    const failed = await client.createSession(sessionConfig(job, (e) => events.push(e), async () => ({
      isError: true, content: [{ type: 'text', text: 'Host rejected the operation.' }],
    })));
    await failed.rpc.tools.initializeAndValidate();
    const second = await failed.rpc.tools.execute({ name: 'agentcraft_echo', arguments: { text: 'denied' } });
    expect(second).toMatchObject({ resultType: 'failure' });
    expect(JSON.stringify(second)).toContain('Host rejected the operation.');
    expect(events.length).toBeGreaterThan(0);
    await failed.disconnect();
  } finally {
    const errors = await client.stop();
    rmrf(home);
    expect(errors).toEqual([]);
  }
}, 60_000);
