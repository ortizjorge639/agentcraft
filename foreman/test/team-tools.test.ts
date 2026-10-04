import { expect, it } from 'vitest';
import { buildTools, type ToolHooks } from '../src/agents/tools.js';
import { makeForeman, tempDir, rmrf } from './helpers.js';

const hooks: ToolHooks = {
  onReview() {}, onChangesRequested() {}, onTasksChanged() {}, onMergeRequested() {}, onWaiting() {},
};

it('validates and executes team commands without a provider SDK server', async () => {
  const home = tempDir();
  const h = makeForeman(home);
  try {
    const tools = buildTools(h.fm, 'kit', 'worker', hooks);
    expect(tools.some((t) => t.name === 'create_task')).toBe(false);
    const status = tools.find((t) => t.name === 'report_status')!;
    await expect(status.handler({ activity: 42 })).rejects.toThrow();
    await status.handler({ activity: 'checking a worktree' });
    expect(h.fm.agent('kit')!.activity).toBe('checking a worktree');
  } finally {
    await h.fm.close();
    rmrf(home);
  }
});
