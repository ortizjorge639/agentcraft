import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mac = fileURLToPath(new URL('../mac.mjs', import.meta.url));
const marketplace = fileURLToPath(new URL('../../.github/plugin/marketplace.json', import.meta.url));
const plugin = fileURLToPath(new URL('../../.github/plugins/agentcraft-studio/plugin.json', import.meta.url));
const startCommand = fileURLToPath(new URL(
  '../../.github/plugins/agentcraft-studio/com.github.copilot/commands/agentcraft-start.prompt.md',
  import.meta.url,
));

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
    '$paths=$env:AGENTCRAFT_TEST_LAUNCHERS -split [IO.Path]::PathSeparator; foreach($path in $paths) { $tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors); if ($errors.Count) { $errors | ForEach-Object { Write-Error (\"$path`: \" + $_.Message) }; exit 1 } }',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENTCRAFT_TEST_LAUNCHERS: [
        fileURLToPath(new URL('../launch.ps1', import.meta.url)),
        fileURLToPath(new URL('../start-copilot.ps1', import.meta.url)),
      ].join(process.platform === 'win32' ? ';' : ':'),
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('Windows Copilot starter help is deterministic and side-effect free', { skip: process.platform !== 'win32' }, () => {
  const starter = fileURLToPath(new URL('../start-copilot.ps1', import.meta.url));
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', starter, '-Help',
  ], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /-Repo <git-root>/);
  assert.match(result.stdout, /-Ci <command>/);
  assert.match(result.stdout, /Run only one Copilot Foreman at a time/);
});

test('Windows Copilot starter fails closed without an explicit repo and CI command', { skip: process.platform !== 'win32' }, () => {
  const starter = fileURLToPath(new URL('../start-copilot.ps1', import.meta.url));
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', starter,
  ], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /-Repo and -Ci are required/);
});

test('AgentCraft Copilot slash command is linked through the local marketplace', () => {
  const marketplaceJson = JSON.parse(fs.readFileSync(marketplace, 'utf8'));
  const pluginJson = JSON.parse(fs.readFileSync(plugin, 'utf8'));
  const command = fs.readFileSync(startCommand, 'utf8');
  const entry = marketplaceJson.plugins.find((candidate) => candidate.name === 'agentcraft-studio');

  assert.equal(marketplaceJson.name, 'agentcraft');
  assert.equal(entry?.source, '.github/plugins/agentcraft-studio');
  assert.equal(pluginJson.name, 'agentcraft-studio');
  assert.match(command, /tools\\start-copilot\.ps1/);
  assert.match(command, /\$ARGUMENTS/);
  assert.match(command, /when `\$ARGUMENTS` is empty, run this bounded onboarding sequence/i);
  assert.match(command, /ask exactly one question\s+at\s+a\s+time/i);
  assert.match(command, /do not\s+scan for, select, or infer a repository/i);
  assert.match(command, /do not infer a command from repository files/i);
  assert.match(command, /Begin AgentCraft/);
  assert.match(command, /invoke\s+`tools\\start-copilot\.ps1` once/i);
  assert.match(command, /do not fall back to `tools\\launch\.ps1`/i);
});
