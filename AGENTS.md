# AgentCraft agent entry point

This fork's Copilot integration is on `copilot-backend` in
`https://github.com/ortizjorge639/agentcraft`. Confirm the branch and remotes before
changing or publishing work; preserve unrelated local changes.

For **Windows setup, pickup, or Copilot/Minecraft acceptance**, read
[docs/WINDOWS-HANDOFF.md](docs/WINDOWS-HANDOFF.md) before running commands or
changing code. It defines the reading order, bounded acceptance checks, authority
limits, and required evidence. Continue the existing integration.

For runtime changes, read [foreman/README.md](foreman/README.md); for launcher
changes, read [tools/README.md](tools/README.md). Use the repository's existing
checks and retain Claude compatibility and Copilot's fail-closed merge guards.

These instructions guide the development assistant. Embedded AgentCraft Copilot
workers intentionally disable custom-instruction discovery; retain that isolation.
