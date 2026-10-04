# tools/

## macOS

Requires Node 22.18+, git, and Java 25. Install Java with `brew install openjdk@25`;
`mac.mjs` uses Homebrew's JDK directly, so no system Java changes are needed.

```sh
node tools/mac.mjs launch --backend sim             # free simulated team
node tools/mac.mjs stop --profile sim
node tools/mac.mjs launch --repo /path/to/repo --use-claude-login
node tools/mac.mjs launch --backend copilot --repo /path/to/repo
node tools/mac.mjs stop                            # save/quit game, stop Foreman
```

The launcher installs npm dependencies on first use, runs the Fabric development client,
and waits for the studio world. It reuses a running Foreman or game from the same profile.
Use `--dev` for mute/no focus/no notifications; `--no-game` or `--no-foreman` to run just
one component; `--no-wait` to return immediately while Minecraft builds. Repeat
`--foreman-arg VALUE` to pass extra Foreman options. Logs and process records live in
`artifacts/logs/mac-*.log` and `artifacts/run/mac-*.json`. `stop` only signals processes
recorded by this launcher. macOS uses Notification Center for agent decisions.
The screenshot QA command, `node tools/qa.mjs`, also uses this launcher on macOS.

## Windows

Windows PowerShell 5.1+ and Node 22.18+. `launch.ps1` installs the npm dependencies it needs on the
first run (`npm ci` in `foreman/` and `tools/`); the Gradle wrapper downloads Gradle, Minecraft
and Fabric by itself. Java 25 must be installed (Temurin 25: https://adoptium.net).

## Recommended Copilot startup

`start-copilot.ps1` is the fail-closed entry point for normal GitHub Copilot sessions against
arbitrary trusted repositories. It requires an explicit repository and CI command, verifies the
target is a clean Git root on a checked-out branch, checks Git, Node 22.18+ and Java 25, derives a
stable profile when one is not supplied, then delegates to `launch.ps1` with one bounded worker.

```powershell
copilot /login  # interactive; needed only when the account is not already authenticated

tools\start-copilot.ps1 `
  -Repo C:\code\my-project `
  -Ci "npm test" `
  -Profile my-project-01
```

From `cmd.exe` or Explorer use `tools\start-copilot.cmd` with the same arguments. Add `-Login` to
run the interactive login from the starter, `-FullPreflight` on a new or changed AgentCraft
checkout, `-Dev` for muted/no-focus QA, or `-DryRun` to inspect the launch without starting it.
Resume with the same home/profile/ports; use a new profile for independent work. Run only one
Copilot Foreman at a time; the starter refuses a different live profile under the selected home
while allowing an exact-profile resume. Keep separate profiles for unrelated repositories and
configure a real verification command (`npm test`, `pytest`, `cargo test`, `go test ./...`,
`dotnet test`, etc.); the starter never guesses one.

The starter refuses a dirty target because approved merges require a stable base. AgentCraft
still treats the target as trusted: tests and repository scripts execute on the host, and git
guards are not an OS sandbox.

### Copilot CLI slash command

Install the repository's AgentCraft Studio plugin once from the AgentCraft repository root:

```powershell
copilot plugin marketplace add ./
copilot plugin install agentcraft-studio@agentcraft
```

Start a new interactive Copilot CLI session from that same root and invoke the command:

```powershell
copilot
```

```text
/agentcraft-start
```

The bare command asks for the target repository, exact CI command, and launch
mode one question at a time, then shows the resolved safe defaults before
starting. For the non-interactive fast path:

```text
/agentcraft-start repo="C:\code\my-project" ci="npm test"
```

The command is a thin prompt adapter to `tools\start-copilot.ps1`; it does not duplicate or bypass
the script's checks. Add `login`, `full-preflight`, `dev`, or `dry-run` as standalone flags, and
use `/agentcraft-start help` for examples. This path-sourced marketplace loads the plugin from the
working tree; start a new Copilot session or use `/restart` after editing its files. Once Minecraft
is ready, the setup CLI session is no longer required and can be closed with `/exit`.

## Daily use

```powershell
tools\launch.ps1                              # claude backend, state in ~/.agentcraft, Foreman :7878, DevBridge :7879
tools\launch.ps1 -Repo C:\code\life-tracker   # also register a repo with the Foreman
tools\launch.ps1 -Backend sim                 # scripted demo team (no API calls), demo repo in sandbox/
tools\launch.ps1 -Backend copilot -Repo C:\code\my-repo  # experimental; authenticate Copilot first
tools\launch.ps1 -Showcase                    # static showcase state (sim); -Showcase late for the later one
tools\stop.ps1                                # stop what launch.ps1 started (game + Foreman)
tools\stop.ps1 -Game                          # just the game: agents keep working, relaunch any time
```

From `cmd.exe` or Explorer: `tools\launch.cmd` / `tools\stop.cmd` (same arguments).

`launch.ps1`:
1. Reuses a running Foreman for `<home>/<profile>` (its `foreman.json` pid alive + port answering),
   otherwise starts one in the background (hidden console; log `artifacts\logs\foreman-<profile>.log`).
2. Builds if needed and starts Minecraft (`gradlew runClient`, `GRADLE_USER_HOME` =
   `<repo>\.gradle-home`), passing `AGENTCRAFT_PORT`, `AGENTCRAFT_DEV_PORT`, `AGENTCRAFT_HOME`,
   `AGENTCRAFT_PROFILE`, `AGENTCRAFT_MUTE=0`, `AGENTCRAFT_FOCUS=1` to the game. Log: `artifacts\logs\game.log`.
3. Waits until the HQ world is ready and prints what runs where and how to stop it.

If the game of this checkout is already running it is reused (one client per checkout: they share
`mod/run`). Quitting the game window leaves the Foreman running (agents keep working); the next
`launch.ps1` reuses it.

| parameter | default | |
| --- | --- | --- |
| `-Backend sim\|claude\|copilot` | `claude` (`AGENTCRAFT_BACKEND`) | `-Showcase` implies `sim` |
| `-Repo <path>[,<path>]` | | registered at start, or sent as `repo.add` to a running Foreman |
| `-Profile <name>` | backend name; `showcase` / `showcase-late` | state lives in `<home>/<profile>` |
| `-Showcase [busy\|late]` | | hold a static scripted state (QA screenshots); always a fresh (`--reset`) profile |
| `-Home <dir>` | `~/.agentcraft` (`AGENTCRAFT_HOME`); with `-Dev`: `<main checkout>\.agentcraft-home` | **QA/tests must pass the project home** |
| `-Port N` / `-DevPort N` | 7878 / 7879 (`AGENTCRAFT_PORT` / `AGENTCRAFT_DEV_PORT`) | 3000/5173/8080 are refused |
| `-Dev` | | unattended runs: muted, never steals focus, no toasts, Gradle daemon exits after 30 idle min |
| `-Reset` | | wipe the profile before starting (new Foreman only) |
| `-Speed x`, `-Autostart`, `-Goal "..."` | | sim speed / start the scripted goal / submit a goal at start |
| `-ForemanArgs @('--workers','kit,wren')` | | extra Foreman flags (`npm run start -- --help`) |
| `-Notify` / `-NoNotify` | Foreman default (on for claude) | Windows toasts |
| `-NoGame`, `-NoForeman`, `-NoWait` | | only the Foreman / only the game / don't wait for the world |
| `-GradleHome <dir>` | `GRADLE_USER_HOME` or `<main checkout>\.gradle-home` | |
| `-TimeoutSec N` | 600 | how long to wait for the world |
| `-SummaryJson <file>` | | machine-readable result (what was started or reused, pids, ports, logs) |
| `-DryRun` | | print the Foreman command, the game command and the game env; start nothing |

`stop.ps1` stops only what `launch.ps1` started, using the run files in `artifacts\run\`
(pid + process start time, so a reused pid is never touched): the game via the DevBridge
`dev.quit` (world saved), the Foreman via Ctrl+Break into its hidden console (the Foreman saves
its state and releases `foreman.json`, like Ctrl+C in a terminal), then, after `-TimeoutSec`
(30), a force-kill of only those process trees. A Foreman that `launch.ps1` reused but did not
start is left alone. `-Game` / `-Foreman` / `-Profile` / `-Home` / `-Port` narrow it down;
`-FromSummary <launch summary>` stops exactly what one launch started; `-StopDaemon` also stops
this checkout's Gradle daemon (never another checkout's).

Copilot uses the SDK's bundled local runtime and a `copilot` profile, not the Claude login.
Authenticate with `copilot /login` or `COPILOT_GITHUB_TOKEN`; model requests can consume account
usage. Both launchers refuse reusing a profile with a different backend. Use `--foreman-arg`
on macOS / `-ForemanArgs` on Windows for `--ci`, `--model` and worker/concurrency limits.
The launchers start the matching Fabric development client, not an arbitrary installed vanilla
Minecraft instance. Native Windows Copilot launch and in-game behavior remain acceptance checks.

## Dev / QA tools

```powershell
node tools/devcli.mjs state --port 7889                 # DevBridge CLI (mod/DEV.md has the full command list)
node tools/foremancli.mjs status --port 27878           # Foreman: backend/auth, agents, tasks, open decisions
node tools/foremancli.mjs diff --decision d3 --port 27878
node tools/foremancli.mjs send user.message to=kit "text=hi there" --port 27878   # any client message, prints the ack
node tools/shoot.mjs tools/scenes/qa.json --only qa01_exterior_hero --port 7889 --foreman 27878 --prefix wip/
node tools/qa.mjs --port 27878 --dev-port 7889 --home C:\Projects\agentcraft\.agentcraft-home
node tools/record.mjs tools/shots/desk_story.json --port 7889 --hold 3000   # play a camera shot for OBS (shots/README.md)
npm test --prefix tools
```

Screenshot QA (scene format, anchor contract, judging): [docs/QA.md](../docs/QA.md).

| file | |
| --- | --- |
| `launch.ps1`, `stop.ps1`, `launch.cmd`, `stop.cmd` | launcher |
| `start-copilot.ps1`, `start-copilot.cmd` | validated, bounded Copilot session starter |
| `lib/procs.ps1` | shared PowerShell helpers (run files, process identity, Ctrl+Break, ports) |
| `lib/bgrun.mjs` | background runner: owns the log files and the hidden console of a background process |
| `devcli.mjs`, `lib/devclient.mjs` | DevBridge client |
| `foremancli.mjs`, `lib/foremanclient.mjs` | Foreman WS client (hello, acks, diff, live state mirror) |
| `shoot.mjs`, `lib/scene.mjs` | scene runner (anchors, screens, Foreman messages, waits) |
| `record.mjs`, `shots/*.json` | real-time shot player for screen recording (`dev.play`: camera paths, timed Foreman injections, typing); format in `shots/README.md` |
| `qa.mjs`, `lib/contactsheet.mjs`, `scenes/qa.json` | QA suite, contact sheet (pngjs) |
| `scenes/phase1.json`, `scenes/qa-selftest.json` | Phase 1 proof scene, runner self-test |
