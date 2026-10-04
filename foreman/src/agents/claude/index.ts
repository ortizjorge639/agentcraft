import type { ClaudeConfig } from '../../config.js';
import type { Foreman } from '../../foreman.js';
import { TeamBackend } from '../team.js';
import { ClaudeRuntime, type ClaudeBackendOptions } from './runtime.js';

export { agentEnv, type ClaudeBackendOptions } from './runtime.js';

export class ClaudeBackend extends TeamBackend {
  constructor(fm: Foreman, cfg: ClaudeConfig, opts: ClaudeBackendOptions = {}) {
    super(fm, cfg, new ClaudeRuntime(fm, cfg, opts));
  }
}
