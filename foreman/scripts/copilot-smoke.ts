import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
  'run', 'test/copilot-sdk.test.ts',
], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, AGENTCRAFT_SDK_SMOKE: '1' }, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
