import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { Foreman } from '../../foreman.js';
import { buildTools, MCP_SERVER, type ToolHooks, type TurnHandle } from '../tools.js';

export { closeIfNoChanges, MCP_SERVER, toolNames, type ToolHooks, type TurnHandle } from '../tools.js';

export function buildMcpServer(fm: Foreman, agentId: string, role: 'lead' | 'worker', hooks: ToolHooks, turn?: TurnHandle) {
  const tools = buildTools(fm, agentId, role, hooks, turn).map((t) =>
    tool(t.name, t.description, t.schema.shape, async (args) => t.handler(args)),
  );
  return createSdkMcpServer({
    name: MCP_SERVER, version: '0.1.0', tools, alwaysLoad: true,
    instructions: 'AgentCraft team tools: coordinate with teammates, ask the user, keep memory and the task board up to date.',
  });
}
