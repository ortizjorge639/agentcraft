# Windows Copilot handoff

## Start here

Continue the existing SDK-backed Copilot integration, then establish live
Windows/Minecraft acceptance. Read, in order:

1. [README.md](../README.md): prerequisites and architecture.
2. [foreman/README.md](../foreman/README.md): runtime policy, recovery, verification and evidence.
3. [tools/README.md](../tools/README.md): PowerShell launch/stop options and logs.

The Mac conversation and local notes are not part of this clone. This document
is the handoff; report missing information instead of assuming access to them.

Fresh checkout, in PowerShell:

```powershell
git clone --branch copilot-backend https://github.com/ortizjorge639/agentcraft.git
cd agentcraft
git status --short
git branch --show-current
git remote -v
```

For an existing checkout, inspect status and remotes first, preserve local work,
and fetch/switch to the fork's `copilot-backend` branch. The fork's default branch
is not the Copilot handoff branch. Start the development Copilot assistant from
this repository root and give it:

> Read AGENTS.md and docs/WINDOWS-HANDOFF.md. Continue the Windows acceptance
> handoff, beginning with preflight. Preserve the existing integration and report
> evidence separately from unverified behavior.

## Evidence inherited from the Mac

Implementation commit `ca4fee6fe664b6c470b322cbaffa6cb80a5b3cf0` passed
[all nine native CI jobs](https://github.com/ortizjorge639/agentcraft/actions/runs/37168544313):
Node 22.18/24 checks and Java 25 mod builds across Windows, macOS and Linux.
Later commits need their own checks; this run proves only the named commit.

One live Mac goal with one worker passed actual edits/tests, pause/resume,
Foreman-instance restart at an open question, provider-session recovery, lead
review and a test-client-approved merge. It did not exercise Minecraft UI or a
live permission prompt. One success is not a reliability estimate.

**Still pending:** live Windows provider/process behavior, actual Minecraft
interaction, live permission denial, multi-worker acceptance and repeated
representative canaries. Native CI is not evidence of these behaviors.

## Preflight: no model requests

From the repository root, verify Git, Node 22.18+, Java 25 and PowerShell 5.1+.
Confirm Java is available to Gradle. Run each step separately and stop at the
first failure; record the command, exit code and diagnostic before fixing it.

```powershell
git --version
node --version
java -version
$PSVersionTable.PSVersion
npm ci --prefix foreman
npm ci --prefix tools
npm run check
npm run test:sdk
Push-Location mod
.\gradlew.bat --no-daemon build
Pop-Location
```

`test:sdk` checks the real SDK/runtime contract without inference. Authenticate
through `copilot /login` if needed; let the user complete authentication and
keep credentials out of files, logs and reports.

## Live acceptance: bounded and isolated

Before inference, obtain authorization for account usage and agree a finite
time/request budget. Default to one goal, one worker, a five-minute observation
deadline, lead cap 12 and worker cap 24. Turn caps are per runtime run, not a
total request or charge limit; stop the owned run when the deadline/budget is
reached. Additional scenarios need remaining authorized budget.

Create a trusted, disposable Git repository under `sandbox/windows-copilot-canary`
with committed baseline source and a working zero-dependency `node --test` suite.
Use it as the target, not AgentCraft itself or a real user project. Record its
baseline HEAD and source hashes before submitting any goal.

After the fixture and budget are ready:

```powershell
$Canary = (Resolve-Path .\sandbox\windows-copilot-canary).Path
$HomeDir = Join-Path (Get-Location).Path '.agentcraft-home'
.\tools\launch.ps1 -Backend copilot -Repo $Canary -Home $HomeDir -Profile windows-copilot-qa -Port 27878 -DevPort 27879 -Dev -ForemanArgs @('--workers','kit','--max-concurrent','1','--max-turns-lead','12','--max-turns-worker','24','--ci','node --test')
```

This launches the matching Fabric development client, not installed vanilla
Minecraft. Foreman, its owned CLI runtime and the game run on this Windows PC;
inference is remote. Keep the QA profile separate from personal state. Reuse it
for recovery checks; use fresh named profiles for independent runs.

Record each scenario as **passed, failed, or not exercised**, with supporting
logs and commit/session IDs:

1. The actual game connects and shows Copilot status. Submit one small,
   independently checkable goal; observe worker edits and genuinely executed tests.
2. Pause/resume at a question, then stop/restart Foreman while a question is open.
   Confirm the question and provider session recover without duplicate side effects.
3. Before human approval, verify the target's baseline HEAD and source remain
   unchanged. Review the real diff in Minecraft and have the user approve the
   disposable merge. Run tests and an independent behavior check on the merged result.
4. Deny a prompted write/command when safely exercisable; verify no unauthorized
   side effect. If no prompt occurs, record live denial as not exercised, not passed.
5. Exercise missing/failing tests and source changes after verification; confirm
   stale or unsuccessful verification cannot merge. Exercise cancellation and
   verify owned worker/CLI processes and host operations have stopped.

Use the launcher-owned stop path with the same home/profile:

```powershell
.\tools\stop.ps1 -Home $HomeDir -Profile windows-copilot-qa -Port 27878
```

Do not reset profiles, broadly kill processes, auto-answer permission/merge
decisions, publish changes, or merge into real repositories without separate
scoped authorization. Preserve evidence and existing user data.

## Completion report

Record OS/runtime versions, tested commit, commands/results, task and provider
session IDs, recovery observations, baseline/final commits, game observations,
process cleanup and observed account usage (or explicitly unknown).
Keep tokens and private account details out of the report.

Declare Windows live acceptance complete only when every required scenario
above has evidence. Report partial progress and blockers plainly. Two-worker
integration against an advancing base and repeated reliability canaries are
separate follow-up gates, not implied by this one-worker result.
