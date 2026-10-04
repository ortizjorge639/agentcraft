import type { SessionConfig, SessionEvent } from '@github/copilot-sdk';
import type { ToolResult } from '../tools.js';
import type { WorkerJob } from './wire.js';

export function sessionConfig(
  job: WorkerJob,
  onEvent: (event: SessionEvent) => void,
  invoke: (name: string, args: unknown, sessionId: string, callId: string) => Promise<ToolResult>,
): SessionConfig {
  return {
    ...(job.model ? { model: job.model } : {}),
    workingDirectory: job.cwd, streaming: true,
    systemMessage: { mode: 'replace', content: job.systemPrompt },
    availableTools: job.tools.map((t) => `custom:${t.name}`),
    excludedTools: ['builtin:*', 'mcp:*'],
    tools: job.tools.map((t) => ({
      ...t, defer: 'never',
      // Every host handler performs its own validated AgentCraft policy/role check.
      skipPermission: true,
      handler: async (args, invocation) => {
        const result = await invoke(t.name, args, invocation.sessionId, invocation.toolCallId);
        const content = result.content.map((c) => c.text).join('\n');
        return {
          textResultForLlm: content,
          resultType: result.isError ? 'failure' : 'success',
          ...(result.isError ? { error: content } : {}),
        };
      },
    })),
    onPermissionRequest: async () => ({ kind: 'reject', feedback: 'Use the AgentCraft host tools and permission decisions.' }),
    skipCustomInstructions: true, enableConfigDiscovery: false,
    enableFileHooks: false, enableSkills: false, enableHostGitOperations: false,
    enableOnDemandInstructionDiscovery: false, enableSessionStore: false,
    remoteSession: 'off', manageScheduleEnabled: false, customAgents: [],
    infiniteSessions: { enabled: true }, onEvent,
  };
}
