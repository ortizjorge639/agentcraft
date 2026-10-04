import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CopilotBackend } from '../src/agents/copilot/index.js';
import { buildWorkspaceTools } from '../src/agents/copilot/workspace.js';
import type { AgentRuntime, RunRequest } from '../src/agents/runtime.js';
import { buildTools } from '../src/agents/tools.js';
import { git } from '../src/util/git.js';
import { demoRepo, makeForeman, tempDir, rmrf, until, type Harness } from './helpers.js';

const harnesses: Array<{ h: Harness; home: string; repo: string }> = [];
afterEach(async () => {
  for (const { h, home, repo } of harnesses.splice(0)) {
    await h.fm.close();
    rmrf(home);
    rmrf(path.dirname(repo));
  }
});

async function boot(withQuestion = false, withoutTests = false, ci?: string) {
  const home = tempDir();
  const repo = await demoRepo();
  const h = makeForeman(home, ['--backend', 'copilot', '--workers', 'kit', '--repo', repo, ...(ci ? ['--ci', ci] : [])]);
  const runtime: AgentRuntime = {
    name: 'copilot', label: 'Copilot',
    checkAuth: async () => ({ message: 'scripted external runtime' }),
    run: async (r: RunRequest) => {
      const tools = buildTools(h.fm, r.agentId, r.role, r.hooks, r.turn);
      const call = (name: string, args: unknown) => tools.find((t) => t.name === name)!.handler(args);
      r.onSession(`copilot-${r.agentId}`);
      if (r.prompt.startsWith('New goal')) {
        await call('create_task', { title: 'Document the feature', description: 'Add a README line', assignee: 'kit' });
      } else if (r.role === 'worker') {
        const workspace = buildWorkspaceTools(r);
        await workspace.find((t) => t.name === 'Write')!.handler({ file_path: 'README.md', content: '# Pocket notes\nCopilot feature.\n' });
        if (withoutTests) await workspace.find((t) => t.name === 'Write')!.handler({ file_path: 'package.json', content: '{"type":"module"}\n' });
        if (withQuestion) await call('ask_user', { question: 'Keep the example?', options: ['Yes', 'No'] });
        await call('update_task', { task_id: h.fm.agent('kit')!.taskId, status: 'review', summary: 'README updated' });
      } else {
        await call('request_merge', { task_id: 't1', summary: 'Reviewed the real diff and CI' });
      }
      return { sessionId: `copilot-${r.agentId}`, numTurns: 1, isError: false, errors: [], subtype: 'success' };
    },
  };
  await h.fm.start(new CopilotBackend(h.fm, h.cfg.copilot, runtime));
  harnesses.push({ h, home, repo });
  return { h, repo };
}

it('never presents missing tests as a passing Copilot task', async () => {
  const { h } = await boot(false, true);
  await h.fm.submitGoal('Document the feature');
  await until(() => h.fm.tasks.get('t1')?.status === 'blocked' || h.fm.decisions.open().some((d) => d.kind === 'merge'));
  expect(h.fm.tasks.get('t1')!.status).toBe('blocked');
  expect(h.fm.tasks.get('t1')!.ci).toBe('unknown');
  expect(h.fm.decisions.open().some((d) => d.kind === 'merge')).toBe(false);
});

it('asks in game and leaves the base unchanged until an approved, tested merge', async () => {
  const { h, repo } = await boot(true);
  const original = fs.readFileSync(path.join(repo, 'README.md'), 'utf8');
  await h.fm.submitGoal('Document the feature');
  await until(() => h.fm.decisions.open().some((d) => d.kind === 'question'));
  const question = h.fm.decisions.open().find((d) => d.kind === 'question')!;
  expect(h.fm.agent('kit')!.state).toBe('waiting_user');
  await h.fm.answerDecision(question.id, 'Yes');
  await until(() => h.fm.decisions.open().some((d) => d.kind === 'merge'));
  expect(h.fm.tasks.get('t1')!.ci).toBe('pass');
  expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe(original);
  expect(h.fm.status.costUsd).toBeUndefined();
  const merge = h.fm.decisions.open().find((d) => d.kind === 'merge')!;
  await h.fm.answerDecision(merge.id, 'Merge');
  await until(() => h.fm.tasks.get('t1')!.status === 'done');
  expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toContain('Copilot feature.');
  expect(h.fm.store.data.sessions['kit:t1']!.provider).toBe('copilot');
});

it('refuses an approval when the worktree changed after its tests passed', async () => {
  const { h, repo } = await boot();
  const original = fs.readFileSync(path.join(repo, 'README.md'), 'utf8');
  await h.fm.submitGoal('Document the feature');
  await until(() => h.fm.decisions.open().some((d) => d.kind === 'merge'));
  const task = h.fm.tasks.get('t1')!;
  const wt = h.fm.repos.requireWorktree(task.repoId!, task.worktree!);
  fs.appendFileSync(path.join(wt.path, 'README.md'), 'Untested change.\n');
  const merge = h.fm.decisions.open().find((d) => d.kind === 'merge')!;
  await h.fm.answerDecision(merge.id, 'Merge');
  expect(h.fm.tasks.get('t1')!.status).toBe('review');
  expect(h.fm.decisions.get(merge.id)!.status).toBe('open');
  expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe(original);
});

it.each([
  'node -e "process.exit(1)"',
  'node -e "require(\'fs\').appendFileSync(\'README.md\', \'changed during tests\')"',
])('blocks unsuccessful or source-mutating verification: %s', async (ci) => {
  const { h } = await boot(false, false, ci);
  await h.fm.submitGoal('Document the feature');
  await until(() => h.fm.tasks.get('t1')?.status === 'blocked');
  expect(h.fm.tasks.get('t1')!.ci).toBe('fail');
  expect(h.fm.decisions.open().some((d) => d.kind === 'merge')).toBe(false);
});

it('returns an approved task for re-verification when another merge advanced the base', async () => {
  const { h, repo } = await boot();
  await h.fm.submitGoal('Document the feature');
  await until(() => h.fm.decisions.open().some((d) => d.kind === 'merge'));
  const merge = h.fm.decisions.open().find((d) => d.kind === 'merge')!;
  fs.writeFileSync(path.join(repo, 'parallel.txt'), 'independent feature\n');
  await git(repo, ['add', 'parallel.txt']);
  await git(repo, ['commit', '-m', 'Parallel task landed']);
  await h.fm.answerDecision(merge.id, 'Merge');
  expect(h.fm.tasks.get('t1')!.status).not.toBe('done');
  expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).not.toContain('Copilot feature.');
  expect(fs.readFileSync(path.join(repo, 'parallel.txt'), 'utf8')).toBe('independent feature\n');
});
