import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { CopilotRuntime } from '../src/agents/copilot/runtime.js';
import type { RunRequest } from '../src/agents/runtime.js';
import { processTable } from '../src/util/proc.js';
import { makeForeman, tempDir, rmrf, until, type Harness } from './helpers.js';

const active: Array<{ h: Harness; abort: AbortController }> = [];
afterEach(async () => {
  for (const { h, abort } of active.splice(0)) {
    abort.abort();
    await h.fm.close();
    rmrf(h.home);
  }
});

function setup(prompt: string) {
  const h = makeForeman(tempDir(), ['--backend', 'copilot']);
  const abort = new AbortController();
  active.push({ h, abort });
  const children: ChildProcess[] = [];
  const r: RunRequest = {
    agentId: 'kit', role: 'worker', cwd: h.home, model: '', maxTurns: 2,
    prompt, systemPrompt: '', resume: 'saved-session',
    turn: { signal: abort.signal, reason: () => 'stop' },
    hooks: { onReview() {}, onChangesRequested() {}, onTasksChanged() {}, onMergeRequested() {}, onWaiting() {} },
    authorize: async (name, input) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return name === 'Write' ? { behavior: 'deny', message: 'not approved' } : { behavior: 'allow', updatedInput: input };
    },
    onChild: (child) => children.push(child), onSession: vi.fn(),
  };
  const runtime = new CopilotRuntime(h.fm, h.cfg.copilot, fileURLToPath(new URL('./fixtures/copilot-worker.ts', import.meta.url)));
  return { h, abort, children, r, runtime };
}

it('round-trips host tools, deduplicates concurrent/durable domain receipts, and preserves resume args', async () => {
  const { h, runtime, r, children } = setup('tools');
  const status = vi.spyOn(h.fm, 'setAgent');
  for (let i = 0; i < 2; i++) {
    const result = await runtime.run(r);
    expect(result.isError).toBe(false);
    expect(result.resultText).toBe('saved-session:tools');
  }
  expect(status.mock.calls.filter(([, patch]) => patch.activity === 'from IPC')).toHaveLength(1);
  expect(h.fm.store.data.toolReceipts!['external-session:domain']).toBeDefined();
  expect(fs.existsSync(path.join(h.home, 'denied.txt'))).toBe(false);
  expect(children.every((c) => c.exitCode === 0)).toBe(true);
});

it.each(['crash', 'invalid', 'limit'])('surfaces %s as a failed turn and reaps the worker', async (mode) => {
  const { runtime, r, children } = setup(mode);
  const result = await runtime.run(r);
  expect(result.isError).toBe(true);
  expect(result.errors.length).toBeGreaterThan(0);
  expect(children[0]!.exitCode !== null || children[0]!.signalCode !== null).toBe(true);
});

it('cancels the owned external process tree before completing a stopped turn', async () => {
  const { h, abort, runtime, r, children } = setup('hold');
  const turn = runtime.run(r);
  await until(() => h.events.some((e) => e.type === 'agent.log' && e.entries.some((v) => v.text.startsWith('owned child '))));
  const event = h.events.find((e) => e.type === 'agent.log' && e.entries.some((v) => v.text.startsWith('owned child ')))!;
  if (event.type !== 'agent.log') throw new Error('missing process evidence');
  const pid = Number(event.entries.find((v) => v.text.startsWith('owned child '))!.text.split(' ').at(-1));
  abort.abort();
  const result = await turn;
  expect(result.subtype).toBe('aborted');
  expect(children[0]!.exitCode !== null || children[0]!.signalCode !== null).toBe(true);
  await until(() => {
    try { process.kill(pid, 0); return false; } catch { return true; }
  }, 5000);
  expect((await processTable())!.some((e) => e.pid === pid)).toBe(false);
}, 15_000);
