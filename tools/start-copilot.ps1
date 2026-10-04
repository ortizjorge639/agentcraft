<#
.SYNOPSIS
  Validate a target repository and start a bounded GitHub Copilot AgentCraft session.

.EXAMPLE
  tools\start-copilot.ps1 -Repo C:\code\my-app -Ci "npm test"

.EXAMPLE
  tools\start-copilot.ps1 -Repo C:\code\my-app -Ci "pytest" -Profile python-app-01 -Dev

.EXAMPLE
  tools\start-copilot.ps1 -Repo C:\code\my-app -Ci "npm test" -Login -FullPreflight
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$Repo,
    [string]$Ci,
    [string]$Profile,
    [int]$Port = 29878,
    [int]$DevPort = 29879,
    [Alias('Home')][string]$AgentHome,
    [string]$Workers = 'kit',
    [int]$MaxConcurrent = 1,
    [int]$MaxTurnsLead = 12,
    [int]$MaxTurnsWorker = 24,
    [string]$Model,
    [switch]$Login,
    [switch]$FullPreflight,
    [switch]$Dev,
    [switch]$DryRun,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Launch = Join-Path $PSScriptRoot 'launch.ps1'

function Show-Usage {
    Write-Host @'
AgentCraft GitHub Copilot session starter

Usage:
  tools\start-copilot.ps1 -Repo <git-root> -Ci <test-command> [options]

Required:
  -Repo <path>          Trusted target Git repository root
  -Ci <command>         Real verification command, for example "npm test"

Common options:
  -Profile <name>       State profile (default: copilot-<repo-name>)
  -Home <path>          AgentCraft state root (default: <checkout>\.agentcraft-home)
  -Port <number>        Foreman WebSocket port (default: 29878)
  -DevPort <number>     Minecraft DevBridge port (default: 29879)
  -Workers <ids>        Comma-separated workers (default: kit)
  -MaxConcurrent <n>    Concurrent workers (default: 1)
  -Model <id>           Optional account-available Copilot model
  -Login                Run the interactive `copilot /login` first
  -FullPreflight        Restore dependencies and run checks, SDK smoke, and mod build
  -Dev                  Muted, no focus stealing, no notifications
  -DryRun               Print launch commands without starting AgentCraft

Resume a session by using the same Home, Profile, Port, and DevPort.
Use a new Profile for an independent session. Run only one Copilot Foreman at a time.
'@
}

function Fail([string]$Message, [int]$Code = 1) {
    Write-Host "start-copilot: $Message" -ForegroundColor Red
    exit $Code
}

function Run-Step([string]$Name, [scriptblock]$Command) {
    Write-Host "  $Name ..." -ForegroundColor Yellow
    & $Command
    if ($LASTEXITCODE -ne 0) { Fail "$Name failed (exit $LASTEXITCODE)" }
}

if ($Help) {
    Show-Usage
    exit 0
}
if (-not $Repo -or -not $Ci) {
    Show-Usage
    Fail '-Repo and -Ci are required; verification is never inferred by this starter.' 2
}
if ($Ci -match "[`r`n]") { Fail '-Ci must be one command on one line.' }
if ($MaxConcurrent -lt 1) { Fail '-MaxConcurrent must be at least 1.' }
if ($MaxTurnsLead -lt 1 -or $MaxTurnsWorker -lt 1) { Fail 'turn caps must be at least 1.' }
if ($Port -eq $DevPort) { Fail '-Port and -DevPort must differ.' }

$Repo = [System.IO.Path]::GetFullPath($Repo)
if (-not (Test-Path -LiteralPath $Repo -PathType Container)) { Fail "repository does not exist: $Repo" }
if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git'))) { Fail "not a Git repository root: $Repo" }

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { Fail 'Git is required and was not found on PATH.' }
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js 22.18+ is required and was not found on PATH.' }

$nodeVersion = (& $node.Source --version).Trim()
$nodeParts = $nodeVersion.TrimStart('v').Split('.')
if ([int]$nodeParts[0] -lt 22 -or ([int]$nodeParts[0] -eq 22 -and [int]$nodeParts[1] -lt 18)) {
    Fail "Node.js 22.18+ is required (found $nodeVersion)."
}

$javaExe = 'java'
if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
    $javaExe = Join-Path $env:JAVA_HOME 'bin\java.exe'
}
$javaVersion = ''
try {
    $javaVersion = (& $env:ComSpec /d /c "`"$javaExe`" -version 2>&1" | Select-Object -First 1)
} catch {}
if ($javaVersion -notmatch 'version "(\d+)') {
    Fail "Java 25 is required. Set JAVA_HOME to a JDK 25 before starting AgentCraft."
}
if ([int]$Matches[1] -lt 25) { Fail "Java 25 is required (found: $javaVersion)." }

$branch = (& $git.Source -C $Repo branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or -not $branch) { Fail 'the target repository must have a checked-out branch.' }
$dirty = @(& $git.Source -C $Repo status --porcelain)
if ($LASTEXITCODE -ne 0) { Fail 'could not inspect the target repository.' }
if ($dirty.Count -gt 0) {
    Write-Host 'Target repository has uncommitted changes:' -ForegroundColor Red
    $dirty | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Fail 'commit or stash the target changes before starting AgentCraft.'
}

if (-not $Profile) {
    $slug = (Split-Path -Leaf $Repo).ToLowerInvariant() -replace '[^a-z0-9_-]+', '-'
    $slug = $slug.Trim('-')
    if (-not $slug) { $slug = 'repo' }
    $Profile = "copilot-$slug"
}
if ($Profile -notmatch '^[A-Za-z0-9_-]+$') { Fail "invalid profile '$Profile'." }

if (-not $AgentHome) { $AgentHome = Join-Path $Root '.agentcraft-home' }
$AgentHome = [System.IO.Path]::GetFullPath($AgentHome)

. (Join-Path $PSScriptRoot 'lib\procs.ps1')
if (Test-Path -LiteralPath $AgentHome -PathType Container) {
    foreach ($profileDir in @(Get-ChildItem -LiteralPath $AgentHome -Directory -ErrorAction SilentlyContinue)) {
        $live = Get-LiveForeman $AgentHome $profileDir.Name
        if (-not $live -or $profileDir.Name -eq $Profile) { continue }
        Fail ("Copilot profile '{0}' is already running on port {1}. Stop it before starting '{2}'." -f
            $profileDir.Name, $live.port, $Profile)
    }
}

if ($Login) {
    $copilot = Get-Command copilot -ErrorAction SilentlyContinue
    if (-not $copilot) {
        Fail 'the `copilot` command is unavailable. Install GitHub Copilot CLI or authenticate with COPILOT_GITHUB_TOKEN.'
    }
    Write-Host 'Starting interactive GitHub Copilot login...' -ForegroundColor Cyan
    & $copilot.Source /login
    if ($LASTEXITCODE -ne 0) { Fail "Copilot login failed (exit $LASTEXITCODE)." }
}

if ($FullPreflight) {
    Write-Host ''
    Write-Host 'Full preflight' -ForegroundColor Cyan
    Run-Step 'restore Foreman dependencies' { & npm ci --prefix (Join-Path $Root 'foreman') --no-audit --no-fund }
    Run-Step 'restore tools dependencies' { & npm ci --prefix (Join-Path $Root 'tools') --no-audit --no-fund }
    Run-Step 'deterministic checks' { & npm run check --prefix $Root }
    Run-Step 'Copilot SDK contract' { & npm run test:sdk --prefix $Root }
    Run-Step 'Minecraft mod build' {
        Push-Location (Join-Path $Root 'mod')
        try { & .\gradlew.bat --no-daemon build } finally { Pop-Location }
    }
}

$foremanArgs = @(
    '--workers', $Workers,
    '--max-concurrent', "$MaxConcurrent",
    '--max-turns-lead', "$MaxTurnsLead",
    '--max-turns-worker', "$MaxTurnsWorker",
    '--ci', $Ci
)
if ($Model) { $foremanArgs += @('--model', $Model) }

Write-Host ''
Write-Host 'Copilot session' -ForegroundColor Cyan
Write-Host "  repo       $Repo"
Write-Host "  branch     $branch"
Write-Host "  tests      $Ci"
Write-Host "  profile    $Profile"
Write-Host "  ports      Foreman $Port, DevBridge $DevPort"
Write-Host "  workers    $Workers (max concurrent $MaxConcurrent)"
Write-Host ''

$launchArgs = @{
    Backend = 'copilot'
    Repo = @($Repo)
    AgentHome = $AgentHome
    ForemanProfile = $Profile
    Port = $Port
    DevPort = $DevPort
    ForemanArgs = $foremanArgs
}
if ($Dev) { $launchArgs.Dev = $true }
if ($DryRun) { $launchArgs.DryRun = $true }

& $Launch @launchArgs
exit $LASTEXITCODE
