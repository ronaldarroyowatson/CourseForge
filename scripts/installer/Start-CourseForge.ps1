#!/usr/bin/env powershell
<#
.SYNOPSIS
Start the CourseForge application locally with an HTTP server
.DESCRIPTION
This script starts a local HTTP server to serve the CourseForge webapp and opens it in the default browser.
#>

param()

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$webappDir = Join-Path $scriptDir "webapp"
$serverScript = Join-Path $scriptDir "courseforge-serve.js"
$bundledNodeExe = Join-Path (Join-Path $scriptDir "node-runtime") "node.exe"
$port       = 3000
$hostName   = "localhost"
$logDir     = Join-Path $env:LOCALAPPDATA "CourseForge\logs"
$launcherLog = Join-Path $logDir "launcher.log"
$serverStdoutLog = Join-Path $logDir "server-stdout.log"
$serverStderrLog = Join-Path $logDir "server-stderr.log"

function Write-LauncherLog {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -Path $launcherLog -Value $line -Encoding ASCII
}

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# ── Read version and asset template from package-manifest.json (never hard-coded) ──
$manifestPath   = Join-Path $scriptDir "package-manifest.json"
$currentVersion = "unknown"
$assetTemplate  = "CourseForge-{version}-portable.zip"
if (Test-Path $manifestPath) {
  try {
    $manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.version)                { $currentVersion = $manifest.version }
    if ($manifest.updates.assetTemplate)  { $assetTemplate  = $manifest.updates.assetTemplate }
  } catch {
    Write-LauncherLog "WARNING: Failed to read package-manifest.json. $($_.Exception.Message)"
  }
}

Write-LauncherLog "Launcher initialized. Version=$currentVersion AssetTemplate=$assetTemplate"

# Verify webapp directory exists
if (-not (Test-Path $webappDir)) {
  Write-LauncherLog "ERROR: Webapp directory not found at $webappDir"
  exit 1
}

# Verify server script exists
if (-not (Test-Path $serverScript)) {
  Write-LauncherLog "ERROR: Server script not found at $serverScript"
  exit 1
}

# Check if Node.js is available (prefer bundled runtime to avoid machine-level install issues)
$nodePath = $null
if (Test-Path $bundledNodeExe) {
  $nodePath = $bundledNodeExe
  Write-LauncherLog "Using bundled Node runtime: $bundledNodeExe"

  $runtimeRoot = Split-Path -Parent $bundledNodeExe
  if ($env:Path -notmatch [regex]::Escape($runtimeRoot)) {
    $env:Path = "$runtimeRoot;$env:Path"
  }
}
else {
  $nodeExe = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -eq $nodeExe) {
    Write-LauncherLog "ERROR: Node.js runtime is missing. Please rerun the installer to repair dependencies."
    exit 1
  }

  $nodePath = $nodeExe.Source
  Write-LauncherLog "Using system Node runtime: $nodePath"
}

# Auto-update check (background job)
# ── Apply any staged update BEFORE the server starts ──
$pendingDir  = Join-Path $scriptDir "_pending_update"
$pendingJson = Join-Path $scriptDir "pending-update.json"
if (Test-Path (Join-Path $pendingDir "webapp\index.html")) {
  Write-LauncherLog "Applying staged update from _pending_update/ ..."
  if (Test-Path $pendingJson) {
    try {
      $pendingInfo = Get-Content -Path $pendingJson -Raw | ConvertFrom-Json
      if ($pendingInfo.version) {
        Write-LauncherLog "Pending update metadata: targetVersion=$($pendingInfo.version) asset=$($pendingInfo.assetName) stagedAt=$($pendingInfo.stagedAt)"
      }
    } catch {
      Write-LauncherLog "WARNING: Failed to read pending-update.json. $($_.Exception.Message)"
    }
  }
  $null = robocopy $pendingDir $scriptDir /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XF updater.log /XF pending-update.json /XD _pending_update
  $applyExitCode = $LASTEXITCODE
  if ($applyExitCode -le 7) {
    Remove-Item -Path $pendingDir  -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $pendingJson -Force         -ErrorAction SilentlyContinue
    Write-LauncherLog "Staged update applied. Refreshing version from manifest."
    # Re-read the version and asset template now that new files are in place.
    if (Test-Path $manifestPath) {
      try {
        $manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
        if ($manifest.version)                { $currentVersion = $manifest.version }
        if ($manifest.updates.assetTemplate)  { $assetTemplate  = $manifest.updates.assetTemplate }
      } catch {
        Write-LauncherLog "WARNING: Applied update but failed to refresh package-manifest.json. $($_.Exception.Message)"
      }
    }
    Write-LauncherLog "Active version after apply: $currentVersion"
  } else {
    Write-LauncherLog "WARNING: Apply robocopy exited with code $applyExitCode. Keeping staged update for retry and investigation."
  }
} elseif ((Test-Path $pendingDir) -or (Test-Path $pendingJson)) {
  Write-LauncherLog "WARNING: Found partial staged-update artifacts, but webapp payload is incomplete. Leaving files in place for inspection."
}

# ── Stage the next update in the background (download now, apply next launch) ──
$updateScript = Join-Path $scriptDir "AutoUpdate-CourseForge.ps1"
if (Test-Path $updateScript) {
  Write-LauncherLog "Starting background updater in stage-only mode."
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File",               "`"$updateScript`"",
    "-PackageRoot",        "`"$scriptDir`"",
    "-CurrentVersion",     $currentVersion,
    "-AssetNameTemplate",  $assetTemplate,
    "-StageOnly"
  ) -WindowStyle Hidden | Out-Null
} else {
  Write-LauncherLog "WARNING: AutoUpdate-CourseForge.ps1 not found. Background update check skipped."
}

# Try to find an available port
function Test-PortAvailable {
  param(
    [string]$TargetHost,
    [int]$Port
  )
  
  try {
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    $tcpClient.Connect($TargetHost, $Port)
    $tcpClient.Close()
    return $false  # Port is in use
  }
  catch {
    return $true   # Port is available
  }
}

function Wait-ForHttpReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 15,
    [int]$PollMilliseconds = 250
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -Method Get -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    }
    catch {
      # Keep polling until timeout.
    }

    Start-Sleep -Milliseconds $PollMilliseconds
  }

  return $false
}

# Keep a fixed localhost origin for frontend/backend and OAuth consistency.
$url = "http://${hostName}:$port"
if (-not (Test-PortAvailable -TargetHost $hostName -Port $port)) {
  if (Wait-ForHttpReady -Url $url -TimeoutSeconds 3) {
    Write-LauncherLog "Existing CourseForge server detected at $url. Reusing running server."
    Start-Process $url
    exit 0
  }

  Write-LauncherLog "ERROR: Port $port is in use by another process and no CourseForge server is responding at $url."
  exit 1
}

# Start server in background
Write-LauncherLog "Starting local server on port $port."

foreach ($serverLogPath in @($serverStdoutLog, $serverStderrLog)) {
  if (Test-Path $serverLogPath) {
    Clear-Content -Path $serverLogPath -ErrorAction SilentlyContinue
  }
}

$serverProcess = Start-Process -FilePath $nodePath -ArgumentList @("`"$serverScript`"", "`"$webappDir`"", $port, "`"$hostName`"") -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverStdoutLog -RedirectStandardError $serverStderrLog

# Check if process started successfully
if ($serverProcess.HasExited) {
  Write-LauncherLog "ERROR: Failed to start server. The process exited immediately."
  exit 1
}

$deadline = (Get-Date).AddSeconds(30)
$ready = $false
while ((Get-Date) -lt $deadline) {
  if ($serverProcess.HasExited) {
    $stderrText = if (Test-Path $serverStderrLog) { (Get-Content -Path $serverStderrLog -Raw -ErrorAction SilentlyContinue).Trim() } else { "" }
    if ([string]::IsNullOrWhiteSpace($stderrText)) {
      Write-LauncherLog "ERROR: Local server exited early with code $($serverProcess.ExitCode)."
    }
    else {
      Write-LauncherLog "ERROR: Local server exited early with code $($serverProcess.ExitCode). Details: $stderrText"
    }
    exit 1
  }

  if (Wait-ForHttpReady -Url $url -TimeoutSeconds 2 -PollMilliseconds 250) {
    $ready = $true
    break
  }
}

if (-not $ready) {
  Write-LauncherLog "ERROR: Server endpoint did not become ready within timeout: $url"
  try {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
  }
  catch {
    # Best effort cleanup.
  }
  exit 1
}

Write-LauncherLog "Opening browser to $url."

# Open in default browser
try {
  Start-Process $url
}
catch {
  Write-LauncherLog "WARNING: Could not open browser automatically. Please navigate to $url"
}

# Keep PowerShell window open
Write-Host ""
Write-Host "[CourseForge] Server is running. Close this window to stop the server."
Write-Host "[CourseForge] Access the app at: $url"
Write-Host "[CourseForge] Launcher log: $launcherLog"
Write-Host ""

# Wait for user to close the window or process to exit
while (-not $serverProcess.HasExited) {
  Start-Sleep -Seconds 1
}

Write-LauncherLog "Server stopped."
