import { spawn } from 'node:child_process';
import path from 'node:path';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeConfig } from '../../config.js';
import { FOREMAN_VERSION } from '../../config.js';
import type { Foreman } from '../../foreman.js';
import { withGitSafety } from '../../gitsafety.js';
import { agentGitIdentity } from '../../util/git.js';
import { RuntimeAccessError, type AgentRuntime, type RunRequest, type TurnStats } from '../runtime.js';
import { detectApiAuth, NO_API_AUTH_MESSAGE, withAuthMode } from './auth.js';
import { StreamMapper } from './stream.js';
import { buildMcpServer } from './tools.js';

export function agentEnv(base: NodeJS.ProcessEnv = process.env, who: { agentId?: string; cwd?: string } = {}): Record<string, string | undefined> {
  return withGitSafety(base, {
    CLAUDE_AGENT_SDK_CLIENT_APP: `agentcraft-foreman/${FOREMAN_VERSION}`,
    CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
    ...(who.agentId ? agentGitIdentity(who.agentId) : {}),
  }, who.cwd ? { ceiling: path.dirname(path.resolve(who.cwd)) } : {});
}

export interface ClaudeBackendOptions {
  queryFn?: typeof query;
  skipAuthCheck?: boolean;
}

export class ClaudeRuntime implements AgentRuntime {
  readonly name = 'claude' as const;
  readonly label = 'Claude';
  private queryFn: typeof query;

  constructor(private fm: Foreman, private cfg: ClaudeConfig, private opts: ClaudeBackendOptions = {}) {
    this.queryFn = opts.queryFn ?? query;
  }

  private env(who: { agentId?: string; cwd?: string } = {}) {
    return withAuthMode(agentEnv(process.env, who), this.cfg.useClaudeLogin);
  }

  async checkAuth() {
    const message = `Claude (lead ${this.cfg.leadModel}, workers ${this.cfg.workerModel})`;
    if (this.opts.skipAuthCheck) return { message };
    const api = detectApiAuth(process.env);
    if (!this.cfg.useClaudeLogin && !api.ok) throw new RuntimeAccessError(NO_API_AUTH_MESSAGE);
    async function* never(): AsyncGenerator<never> { await new Promise(() => undefined); }
    const q = this.queryFn({ prompt: never(), options: { settingSources: [], persistSession: false, permissionMode: 'default', env: this.env() } });
    let timer: NodeJS.Timeout | undefined;
    try {
      const info = await Promise.race([
        q.accountInfo(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timed out after 45s')), 45_000); }),
      ]);
      if (!(info.email || info.organization || (info.apiKeySource && info.apiKeySource !== 'none') || (info.tokenSource && info.tokenSource !== 'none') || (info.apiProvider && info.apiProvider !== 'firstParty'))) {
        throw new Error('not logged in');
      }
      const account = this.cfg.useClaudeLogin
        ? [info.organization, info.subscriptionType].filter(Boolean).join(' · ') || info.apiProvider || 'ok'
        : [api.ok ? api.source : 'API', info.organization].filter(Boolean).join(' · ');
      return { message, account };
    } finally {
      if (timer) clearTimeout(timer);
      q.close();
    }
  }

  async run(r: RunRequest): Promise<TurnStats> {
    const options: Options = {
      cwd: r.cwd, model: r.model,
      effort: r.role === 'lead' ? this.cfg.leadEffort : this.cfg.effort,
      maxTurns: r.maxTurns,
      settingSources: [], permissionMode: 'default',
      canUseTool: (name, input, opts) => r.authorize(name, input, opts),
      tools: r.role === 'lead' ? ['Read', 'Grep', 'Glob'] : ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'TodoWrite'],
      disallowedTools: ['Bash(git push:*)', 'Task', 'Agent', 'WebSearch', 'WebFetch'],
      mcpServers: { agentcraft: buildMcpServer(this.fm, r.agentId, r.role, r.hooks, r.turn) },
      systemPrompt: { type: 'preset', preset: 'claude_code', append: r.systemPrompt },
      env: this.env({ agentId: r.agentId, cwd: r.cwd }),
      spawnClaudeCodeProcess: (o) => {
        const child = spawn(o.command, o.args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'], signal: o.signal, windowsHide: true });
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (s: string) => this.fm.log.debug(`[${r.agentId} stderr] ${s.trim().slice(0, 300)}`));
        child.on('error', (e) => this.fm.log.debug(`[${r.agentId}] CLI process error: ${e.message}`));
        r.onChild(child);
        return child;
      },
      ...(r.resume ? { resume: r.resume } : {}),
      ...(this.cfg.maxBudgetUsdPerTurn ? { maxBudgetUsd: this.cfg.maxBudgetUsdPerTurn } : {}),
    };
    const abort = new AbortController();
    const mapper = new StreamMapper(this.fm, r.agentId, r.cwd, r.role);
    options.abortController = abort;
    const q = this.queryFn({ prompt: r.prompt, options });
    const close = () => {
      abort.abort();
      try { q.close(); } catch (e) { this.fm.log.debug(`query close: ${String(e)}`); }
    };
    if (r.turn.signal.aborted) close();
    else r.turn.signal.addEventListener('abort', close, { once: true });
    try {
      for await (const msg of q) {
        if (r.turn.signal.aborted) break;
        mapper.handle(msg);
        if (mapper.stats.sessionId) r.onSession(mapper.stats.sessionId);
      }
      return mapper.stats;
    } finally {
      r.turn.signal.removeEventListener('abort', close);
    }
  }
}
