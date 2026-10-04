@echo off
rem Deterministic AgentCraft GitHub Copilot session starter for cmd.exe / Explorer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-copilot.ps1" %*
exit /b %ERRORLEVEL%
