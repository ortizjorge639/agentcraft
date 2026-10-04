import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CopilotConfig } from '../../config.js';
import type { Foreman } from '../../foreman.js';
import { killTree } from '../../util/proc.js';
import { firstLine, tailLines, truncate } from '../../util/text.js';
import { toolActivity } from '../activity.js';
import type { AgentRuntime, RunRequest, TurnStats } from '../runtime.js';
import { buildTools, MCP_SERVER, type TeamTool, type ToolResult } from '../tools.js';
import { buildWorkspaceTools } from './workspace.js';
import { WorkerMessage, type WorkerEvent, type WorkerJob } from './wire.js';
import { copilotEnv } from './environment.js';
export { copilotEnv } from './environment.js';

export class CopilotRuntime implements AgentRuntime {
  readonly name = 'copilot' as const;
  readonly label = 'Copilot';
  private pendingCalls = new Map<string, { input: string; result: Promise<ToolResult> }>();
  constructor(
    private fm: Foreman, private cfg: CopilotConfig,
    private workerPath = fileURLToPath(new URL('./worker.ts', import.meta.url)),
  ) {}

  private launch(job: WorkerJob): ChildProcess {
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), this.workerPath], {
      cwd: job.cwd, env: copilotEnv(process.env, job.cwd, path.basename(job.home)),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
      detached: process.platform !== 'win32',
    });
    child.stdout?.resume();
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (line: string) => this.fm.log.debug(`copilot worker: ${truncate(line, 300)}`));
    child.send(job);
    return child;
  }

  async checkAuth() {
    const job: WorkerJob = {
      mode: 'probe', home: path.join(this.fm.config.dataDir, 'runtime', 'probe'), cwd: this.fm.config.projectRoot,
      cliPath: this.cfg.cliPath, models: [], prompt: '', systemPrompt: '', tools: [], maxTurns: 1,
    };
    const child = this.launch(job);
    const auth = await new Promise<Extract<WorkerMessage, { type: 'auth' }>>((resolve, reject) => {
      let response: Extract<WorkerMessage, { type: 'auth' }> | undefined;
      let error: Error | undefined;
      const timer = setTimeout(() => { error = new Error('Copilot preflight timed out after 45s'); killTree(child); }, 45_000);
      child.on('message', (raw: unknown) => {
        const message = WorkerMessage.safeParse(raw);
        if (!message.success) { error = new Error('Invalid Copilot preflight response'); killTree(child); return; }
        if (message.data.type === 'auth') response = message.data;
        if (message.data.type === 'error') error = new Error(message.data.message);
      });
      child.on('error', (e) => { error = e; });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (error || code !== 0 || !response) reject(error ?? new Error(`Copilot preflight exited ${code} without an auth result`));
        else resolve(response);
      });
    });
    if (!auth.authenticated) throw new Error('Not authenticated. Run copilot /login or provide COPILOT_GITHUB_TOKEN.');
    for (const model of [this.cfg.leadModel, this.cfg.workerModel].filter(Boolean)) {
      if (!auth.models.includes(model)) throw new Error(`Copilot model "${model}" is not available to this account`);
    }
    return { message: `Copilot CLI ${auth.version} (protocol ${auth.protocol}); usage cost unavailable` };
  }

  async run(r: RunRequest): Promise<TurnStats> {
    const abort = new AbortController();
    const turn = { signal: abort.signal, reason: () => r.turn.reason() };
    const local: RunRequest = { ...r, turn };
    const tools = [
      ...buildWorkspaceTools(local),
      ...buildTools(this.fm, r.agentId, r.role, r.hooks, turn).map((t) => ({ ...t, name: `mcp__${MCP_SERVER}__${t.name}` })),
    ];
    const byName = new Map(tools.map((t) => [t.name, t]));
    const stats: TurnStats = { isError: false, errors: [], numTurns: 0 };
    const job: WorkerJob = {
      mode: 'run', home: path.join(this.fm.config.dataDir, 'runtime', r.agentId), cwd: r.cwd,
      cliPath: this.cfg.cliPath, models: [], model: r.model || undefined, resume: r.resume,
      prompt: r.prompt, systemPrompt: r.systemPrompt, maxTurns: r.maxTurns,
      tools: tools.map((t) => ({ name: t.name, description: t.description, parameters: z.toJSONSchema(t.schema) })),
    };
    const child = this.launch(job);
    r.onChild(child);
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      abort.abort();
      if (child.connected) child.send({ type: 'stop' });
      killTimer ??= setTimeout(() => killTree(child), 2500);
    };
    const names = new Map<string, string>();
    let complete = false;
    const failures = (message: string) => {
      stats.isError = true;
      stats.errors.push(message);
      this.fm.agentLog(r.agentId, 'error', truncate(message, 1000));
    };
    const onEvent = (event: WorkerEvent) => {
      if (abort.signal.aborted) return;
      switch (event.kind) {
        case 'turn':
          stats.numTurns = (stats.numTurns ?? 0) + 1;
          if (stats.numTurns > r.maxTurns) { failures('Copilot turn limit reached'); stop(); }
          break;
        case 'text':
          if (event.text.trim()) this.fm.agentLog(r.agentId, 'text', truncate(event.text, 1200));
          break;
        case 'tool': {
          names.set(event.id, event.name);
          const activity = toolActivity(event.name, event.input, r.cwd);
          this.fm.agentLog(r.agentId, 'tool', activity.label);
          if (this.fm.agent(r.agentId)?.state !== 'waiting_user') this.fm.setAgent(r.agentId, { state: activity.state, station: activity.station, activity: activity.activity });
          break;
        }
        case 'result':
          this.fm.agentLog(r.agentId, event.success ? 'result' : 'error', `${names.get(event.id) ?? 'tool'}: ${tailLines(event.text, 8, 1000)}`);
          if (r.role === 'worker' && this.fm.agent(r.agentId)?.repoId) this.fm.repos.scheduleRefresh(this.fm.agent(r.agentId)!.repoId!, 50);
          break;
        case 'error': failures(event.text); break;
      }
    };
    return new Promise<TurnStats>((resolve) => {
      const handling = new Set<Promise<void>>();
      const handle = async (raw: unknown) => {
        const parsed = WorkerMessage.safeParse(raw);
        if (!parsed.success) { failures('Invalid Copilot worker response'); stop(); return; }
        const message = parsed.data;
        if (abort.signal.aborted) return;
        switch (message.type) {
          case 'session': stats.sessionId = message.id; r.onSession(message.id); break;
          case 'event': onEvent(message.event); break;
          case 'tool': {
            let result: ToolResult;
            try {
              const tool = byName.get(message.name);
              if (!tool) throw new Error(`Unknown or unavailable tool: ${message.name}`);
              if (message.sessionId !== stats.sessionId) throw new Error('Tool call belongs to a different session');
              result = await this.execute(tool, message.args, r, abort.signal, message.sessionId, message.id);
            } catch (e) {
              const error = String(e);
              this.fm.agentLog(r.agentId, 'error', truncate(error, 1000));
              result = { isError: true, content: [{ type: 'text', text: error }] };
            }
            if (child.connected && !abort.signal.aborted) child.send({ type: 'tool_result', id: message.id, result });
            break;
          }
          case 'done': complete = true; stats.resultText = message.text; break;
          case 'error': failures(message.message); stop(); break;
          case 'auth': failures('Unexpected auth result during a job'); stop(); break;
        }
      };
      child.on('message', (raw: unknown) => {
        const operation = handle(raw).catch((e) => { failures(String(e)); stop(); });
        handling.add(operation);
        void operation.finally(() => handling.delete(operation));
      });
      child.on('error', (e) => { failures(e.message); });
      child.once('close', async (code) => {
        abort.abort();
        await Promise.all(handling);
        if (killTimer) clearTimeout(killTimer);
        r.turn.signal.removeEventListener('abort', stop);
        if (!r.turn.signal.aborted && (!complete || code !== 0) && !stats.isError) failures(`Copilot worker exited ${code} without completing the job`);
        stats.subtype = stats.isError ? 'error' : r.turn.signal.aborted ? 'aborted' : 'success';
        resolve(stats);
      });
      if (r.turn.signal.aborted) stop();
      else r.turn.signal.addEventListener('abort', stop, { once: true });
    });
  }

  private async execute(tool: TeamTool, args: unknown, r: RunRequest, signal: AbortSignal, sessionId: string, callId: string): Promise<ToolResult> {
    if (signal.aborted) throw new Error('Turn stopped');
    // Domain calls retain receipts so a transport replay cannot append memory or create a task twice.
    if (!tool.name.startsWith(`mcp__${MCP_SERVER}__`)) return tool.handler(args);
    const input = tool.schema.parse(args);
    const key = `${sessionId}:${callId}`;
    const receipts = (this.fm.store.data.toolReceipts ??= {});
    const hash = JSON.stringify({ tool: tool.name, input });
    const previous = receipts[key];
    if (previous) {
      if (previous.input !== hash) throw new Error('Replayed tool call has different input');
      return previous.result;
    }
    const pending = this.pendingCalls.get(key);
    if (pending) {
      if (pending.input !== hash) throw new Error('Concurrent replay has different input');
      return pending.result;
    }
    const operation = async () => {
      const permission = await r.authorize(tool.name, input, { signal });
      if (permission.behavior !== 'allow') return { isError: true, content: [{ type: 'text' as const, text: permission.message }] };
      if (signal.aborted) throw new Error('Turn stopped');
      const result = await tool.handler(permission.updatedInput);
      receipts[key] = { input: hash, result };
      this.fm.store.markDirty();
      this.fm.store.flush();
      return result;
    };
    const result = operation();
    this.pendingCalls.set(key, { input: hash, result });
    try { return await result; }
    finally { this.pendingCalls.delete(key); }
  }
}
