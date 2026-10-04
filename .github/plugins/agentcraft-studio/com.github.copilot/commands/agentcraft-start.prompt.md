---
description: Onboard or directly launch a bounded GitHub Copilot AgentCraft studio session.
argument-hint: '[repo="C:\code\project" ci="npm test"] [profile="project-01"] [full-preflight] [dev] [dry-run]'
---

# Start an AgentCraft Copilot studio session

This slash command is a strict adapter to the repository-owned
`tools\start-copilot.ps1` script. The script is the source of truth. Do not
reimplement, weaken, or bypass its validation.

User arguments:

```text
$ARGUMENTS
```

## Accepted arguments

- Onboarded or explicit: `repo="<absolute or repository-relative path>"`
- Onboarded or explicit: `ci="<one-line verification command>"`
- Optional: `profile="<letters, digits, hyphens, or underscores>"`
- Optional flags: `login`, `full-preflight`, `dev`, `dry-run`
- Optional integers: `port=<n>`, `dev-port=<n>`, `max-concurrent=<n>`,
  `max-turns-lead=<n>`, `max-turns-worker=<n>`
- Optional: `workers="<comma-separated ids>"`, `model="<model id>"`

If the arguments are exactly `help`, print the usage below and do nothing:

```text
/agentcraft-start
/agentcraft-start repo="C:\code\project" ci="npm test"
/agentcraft-start repo="C:\code\project" ci="pytest" profile="python-01" login full-preflight
/agentcraft-start repo="C:\code\project" ci="cargo test" dev dry-run
```

Reject unknown, duplicated, malformed, or newline-containing arguments. Never
infer the repository, CI command, or approval flags. Never add
`--allow-all-tools`, `--allow-all-paths`, `--allow-all-urls`, or `--yolo`.

Confirm the current working directory contains `tools\start-copilot.ps1`. If
not, stop and tell the user to start Copilot from the AgentCraft repository
root.

## Guided onboarding

When `$ARGUMENTS` is empty, run this bounded onboarding sequence. Use the
interactive question tool when available and ask exactly one question at a
time. Do not invoke the script until onboarding is complete.

1. Ask for the target Git repository path. Recommend an absolute path. Do not
   scan for, select, or infer a repository.
2. Ask for the exact one-line CI or verification command that must pass before
   AgentCraft may merge. Give examples such as `npm test`, `pytest`, and
   `cargo test`, but do not infer a command from repository files.
3. Ask for the launch mode using these choices:
   - `Standard launch (recommended)` maps no additional flag.
   - `Full preflight, then launch` maps to `-FullPreflight`.
   - `Validate only (dry run)` maps to `-DryRun`.
4. Show the resolved repository, CI command, launch mode, and these safe
   defaults: one worker, maximum concurrency 1, launcher-derived profile and
   ports. Ask whether to begin using `Begin AgentCraft` and `Revise inputs`.
   If revision is requested, ask which collected value to replace, one
   question at a time, then show the summary again.

If valid explicit arguments omit either `repo` or `ci`, use the same onboarding
sequence to collect only the missing required value, then show the summary and
confirmation. Preserve all valid explicit options. When both `repo` and `ci`
are explicit, use the direct-launch path without extra onboarding questions.

Map accepted arguments directly to these PowerShell parameters:

| Slash argument | PowerShell parameter |
| --- | --- |
| `repo` | `-Repo` |
| `ci` | `-Ci` |
| `profile` | `-Profile` |
| `login` | `-Login` |
| `full-preflight` | `-FullPreflight` |
| `dev` | `-Dev` |
| `dry-run` | `-DryRun` |
| `port` | `-Port` |
| `dev-port` | `-DevPort` |
| `workers` | `-Workers` |
| `max-concurrent` | `-MaxConcurrent` |
| `max-turns-lead` | `-MaxTurnsLead` |
| `max-turns-worker` | `-MaxTurnsWorker` |
| `model` | `-Model` |

After direct argument validation or an approved onboarding summary, invoke
`tools\start-copilot.ps1` once with only those mapped parameters. Use
PowerShell parameter values rather than concatenating an executable command
string. Do not modify files. Report the script's result and preserve any
failure exactly; do not fall back to `tools\launch.ps1`. After a successful
launch, tell the user that AgentCraft is now controlled from Minecraft and that
they may `/exit` this setup session. Do not exit automatically.
