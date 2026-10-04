import path from 'node:path';
import { withGitSafety } from '../../gitsafety.js';
import { agentGitIdentity } from '../../util/git.js';

export function copilotEnv(base: NodeJS.ProcessEnv, cwd: string, agentId: string, includeAuth = true): NodeJS.ProcessEnv {
  const keys = [
    'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT',
    'ComSpec', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS',
    ...(includeAuth ? ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] : []),
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) if (base[key] !== undefined) env[key] = base[key];
  return withGitSafety(env, agentGitIdentity(agentId), { ceiling: path.dirname(cwd) });
}
