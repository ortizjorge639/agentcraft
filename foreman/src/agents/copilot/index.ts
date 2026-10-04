import type { CopilotConfig } from '../../config.js';
import type { Foreman } from '../../foreman.js';
import type { AgentRuntime } from '../runtime.js';
import { TeamBackend } from '../team.js';
import { CopilotRuntime } from './runtime.js';

export class CopilotBackend extends TeamBackend {
  constructor(fm: Foreman, cfg: CopilotConfig, runtime: AgentRuntime = new CopilotRuntime(fm, cfg)) {
    if (runtime.name !== 'copilot') throw new Error('Copilot backend requires a Copilot runtime');
    super(fm, cfg, runtime);
  }
}
