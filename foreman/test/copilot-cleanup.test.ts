import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { CopilotBackend } from '../src/agents/copilot/index.js';
import type { AgentRuntime } from '../src/agents/runtime.js';
import { buildTools } from '../src/agents/tools.js';
import { demoRepo, makeForeman, tempDir, rmrf, until } from './helpers.js';

const fault = vi.hoisted(() => ({ unreadable: false }));
vi.mock('../src/util/proc.js', async (original) => {
  const actual = await original<typeof import('../src/util/proc.js')>();
  return {
    ...actual,
    processTable: () => fault.unreadable ? Promise.resolve(undefined) : actual.processTable(),
  };
});

it('blocks a completed worker instead of reviewing when cleanup cannot be verified', async () => {
  const home = tempDir();
  const repo = await demoRepo();
  const h = makeForeman(home, ['--backend', 'copilot', '--repo', repo, '--workers', 'kit']);
  const runtime: AgentRuntime = {
    name: 'copilot', label: 'Copilot',
    checkAuth: async () => ({ message: 'scripted provider' }),
    run: async (r) => {
      const tools = buildTools(h.fm, r.agentId, r.role, r.hooks, r.turn);
      const call = (name: string, args: unknown) => tools.find((t) => t.name === name)!.handler(args);
      if (r.role === 'lead') {
        const result = await call('create_task', { title: 'Update documentation', description: 'Add a README line', assignee: 'kit' });
        expect(result.isError).not.toBe(true);
      } else {
        fs.appendFileSync(path.join(r.cwd, 'README.md'), '\nWorker change.\n');
        const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
        r.onChild(child);
        await new Promise<void>((resolve, reject) => { child.once('close', () => resolve()); child.once('error', reject); });
        fault.unreadable = true;
        await call('update_task', { task_id: h.fm.agent('kit')!.taskId, status: 'review', summary: 'Documentation updated' });
      }
      return { isError: false, errors: [] };
    },
  };
  try {
    await h.fm.start(new CopilotBackend(h.fm, h.cfg.copilot, runtime));
    await h.fm.submitGoal('Update documentation');
    await until(() => h.fm.tasks.get('t1')?.status === 'blocked');
    expect(h.fm.tasks.get('t1')!.blockedReason).toContain('Cannot verify Copilot process cleanup');
    expect(h.fm.agent('kit')!.state).toBe('error');
    expect(h.fm.decisions.open().some((d) => d.kind === 'merge')).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).not.toContain('Worker change.');
  } finally {
    fault.unreadable = false;
    await h.fm.close();
    rmrf(home);
    rmrf(path.dirname(repo));
  }
});
