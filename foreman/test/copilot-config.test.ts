import { expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { CopilotBackend } from '../src/agents/copilot/index.js';
import { makeForeman, tempDir, rmrf } from './helpers.js';

it('selects an isolated Copilot profile with provider-specific models', () => {
  const home = tempDir();
  try {
    const cfg = loadConfig(['--home', home, '--backend', 'copilot', '--model', 'gpt-5.4'], {});
    expect(cfg.profile).toBe('copilot');
    expect(cfg.copilot.leadModel).toBe('gpt-5.4');
    expect(cfg.copilot.workerModel).toBe('gpt-5.4');
    expect(cfg.signMerges).toBe(true);
  } finally {
    rmrf(home);
  }
});

it.each([['--use-claude-login'], ['--max-budget', '1'], ['--effort', 'high'], ['--lead-effort', 'high']])('rejects Claude-only option %s', (...flags) => {
  const home = tempDir();
  try {
    expect(() => loadConfig(['--home', home, '--backend', 'copilot', ...flags], {})).toThrow(/not supported/);
  } finally { rmrf(home); }
});

it.each([undefined, 'claude'] as const)('refuses a profile containing legacy or explicit %s sessions before starting a runtime', async (provider) => {
  const home = tempDir();
  const h = makeForeman(home, ['--backend', 'copilot']);
  h.fm.store.data.sessions.saved = { provider, sessionId: 'old-session', turns: 1, costUsd: 0, updatedAt: Date.now() };
  const checkAuth = vi.fn(async () => ({ message: 'must not be reached' }));
  try {
    await h.fm.start(new CopilotBackend(h.fm, h.cfg.copilot, {
      name: 'copilot', label: 'Copilot', checkAuth,
      run: async () => { throw new Error('mixed-provider runtime must not run'); },
    }));
    expect(checkAuth).not.toHaveBeenCalled();
    expect(h.fm.status.auth).toBe('failed');
    expect(h.fm.status.message).toContain('another provider');
  } finally {
    await h.fm.close();
    rmrf(home);
  }
});
