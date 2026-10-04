import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mac = fileURLToPath(new URL('../mac.mjs', import.meta.url));

test('launcher help advertises Copilot without launching anything', () => {
  const result = spawnSync(process.execPath, [mac], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /sim\|claude\|copilot/);
});

test('macOS launcher accepts the Copilot backend and validates flags before touching apps', () => {
  const result = spawnSync(process.execPath, [mac, 'launch', '--backend', 'copilot', '--port', 'invalid'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid port/);
});

test('Copilot launch rejects the Claude login shortcut before touching apps', () => {
  const result = spawnSync(process.execPath, [mac, 'launch', '--backend', 'copilot', '--use-claude-login'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only supported by Claude/);
});

test('Windows launcher parses under native PowerShell', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:AGENTCRAFT_TEST_LAUNCHER,[ref]$tokens,[ref]$errors); if ($errors.Count) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }',
  ], {
    encoding: 'utf8',
    env: { ...process.env, AGENTCRAFT_TEST_LAUNCHER: fileURLToPath(new URL('../launch.ps1', import.meta.url)) },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
