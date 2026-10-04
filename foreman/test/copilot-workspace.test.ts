import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { buildWorkspaceTools } from '../src/agents/copilot/workspace.js';
import { copilotEnv } from '../src/agents/copilot/environment.js';
import type { RunRequest } from '../src/agents/runtime.js';
import { tempDir, rmrf } from './helpers.js';

function request(cwd: string): RunRequest {
  return {
    agentId: 'kit', role: 'worker', cwd, model: '', maxTurns: 4, prompt: '', systemPrompt: '',
    turn: { signal: new AbortController().signal, reason: () => undefined },
    hooks: { onReview() {}, onChangesRequested() {}, onTasksChanged() {}, onMergeRequested() {}, onWaiting() {} },
    authorize: async () => ({ behavior: 'deny', message: 'not approved' }),
    onChild() {}, onSession() {},
  };
}

it('cannot change files when host permission is denied', async () => {
  const dir = tempDir();
  try {
    const tools = buildWorkspaceTools(request(dir));
    const write = tools.find((t) => t.name === 'Write')!;
    const result = await write.handler({ file_path: 'a.txt', content: 'unapproved' });
    expect(result.isError).toBe(true);
    expect(fs.existsSync(path.join(dir, 'a.txt'))).toBe(false);
  } finally {
    rmrf(dir);
  }
});

it('exposes no file mutation or shell tool to the lead', () => {
  const r = request('.');
  r.role = 'lead';
  expect(buildWorkspaceTools(r).map((t) => t.name)).toEqual(['Read', 'Glob', 'Grep']);
});

it('reads, searches, and edits allowed files and rejects ambiguous edits', async () => {
  const dir = tempDir();
  try {
    const r = request(dir);
    r.authorize = async (_tool, input) => ({ behavior: 'allow', updatedInput: input });
    const tools = buildWorkspaceTools(r);
    const call = (name: string, args: unknown) => tools.find((t) => t.name === name)!.handler(args);
    await call('Write', { file_path: 'a.txt', content: 'one\none\ntwo\n' });
    expect((await call('Read', { file_path: 'a.txt', offset: 3, limit: 1 })).content[0]!.text).toBe('3\ttwo');
    expect((await call('Glob', { pattern: '*.txt' })).content[0]!.text).toBe('a.txt');
    expect((await call('Grep', { pattern: 'two', glob: '*.txt' })).content[0]!.text).toBe('a.txt:3:two');
    expect((await call('Edit', { file_path: 'a.txt', old_string: 'one', new_string: 'changed' })).isError).toBe(true);
    await call('Edit', { file_path: 'a.txt', old_string: 'one', new_string: 'changed', replace_all: true });
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('changed\nchanged\ntwo\n');
  } finally { rmrf(dir); }
});

it('cannot edit after an authorization wait is cancelled', async () => {
  const dir = tempDir();
  try {
    const r = request(dir);
    const abort = new AbortController();
    r.turn = { signal: abort.signal, reason: () => 'stop' };
    r.authorize = async (_tool, input) => { abort.abort(); return { behavior: 'allow', updatedInput: input }; };
    const result = await buildWorkspaceTools(r).find((t) => t.name === 'Write')!.handler({ file_path: 'late.txt', content: 'late' });
    expect(result.isError).toBe(true);
    expect(fs.existsSync(path.join(dir, 'late.txt'))).toBe(false);
  } finally { rmrf(dir); }
});

it('keeps runtime authentication but excludes provider tokens and arbitrary secrets from shell environments', () => {
  const env = { PATH: '/bin', GH_TOKEN: 'test-only', PRIVATE_TEST_SECRET: 'test-only', NODE_OPTIONS: '--inspect' };
  expect(copilotEnv(env, '.', 'kit').GH_TOKEN).toBe('test-only');
  const shell = copilotEnv(env, '.', 'kit', false);
  expect(shell.PATH).toBe('/bin');
  expect(shell.GH_TOKEN).toBeUndefined();
  expect(shell.PRIVATE_TEST_SECRET).toBeUndefined();
  expect(shell.NODE_OPTIONS).toBeUndefined();
  expect(shell.GIT_CONFIG_COUNT).toBeDefined();
});
