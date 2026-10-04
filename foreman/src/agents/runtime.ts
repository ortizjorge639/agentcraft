import type { ChildProcess } from 'node:child_process';
import type { ToolHooks, TurnHandle } from './tools.js';

export class RuntimeAccessError extends Error {}

export interface TurnStats {
  sessionId?: string;
  resultText?: string;
  subtype?: string;
  isError: boolean;
  costUsd?: number;
  numTurns?: number;
  authFailed?: string;
  errors: string[];
}

export type PermissionReply =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

export interface RunRequest {
  agentId: string;
  role: 'lead' | 'worker';
  cwd: string;
  model: string;
  maxTurns: number;
  prompt: string;
  systemPrompt: string;
  resume?: string;
  turn: TurnHandle;
  hooks: ToolHooks;
  authorize(tool: string, input: Record<string, unknown>, opts: { signal: AbortSignal; title?: string }): Promise<PermissionReply>;
  onChild(child: ChildProcess): void;
  onSession(sessionId: string): void;
}

export interface AgentRuntime {
  readonly name: 'claude' | 'copilot';
  readonly label: string;
  checkAuth(): Promise<{ message: string; account?: string }>;
  run(request: RunRequest): Promise<TurnStats>;
}
