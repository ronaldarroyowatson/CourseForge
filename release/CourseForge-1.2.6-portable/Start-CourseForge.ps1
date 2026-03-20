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
$port = 3000
$hostName = "localhost"
$logDir = Join-Path $env:LOCALAPPDATA "CourseForge\logs"
$launcherLog = Join-Path $logDir "launcher.log"
$serverStdoutLog = Join-Path $logDir "server-stdout.log"
$serverStderrLog = Join-Path $logDir "server-stderr.log"

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-LauncherLog {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -Path $launcherLog -Value $line -Encoding ASCII
}

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

# Check if Node.js is available
$nodeExe = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $nodeExe) {
  Write-LauncherLog "ERROR: Node.js is not installed or not in PATH."
  exit 1
}

# Auto-update check (background job)
$updateScript = Join-Path $scriptDir "AutoUpdate-CourseForge.ps1"
if (Test-Path $updateScript) {
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", "`"$updateScript`"",
    "-CurrentVersion", "1.2.6",
    "-AssetNameTemplate", "CourseForge-{version}-windows.zip"
  ) -WindowStyle Hidden | Out-Null
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

$serverProcess = Start-Process -FilePath $nodeExe.Source -ArgumentList @("`"$serverScript`"", "`"$webappDir`"", $port, "`"$hostName`"") -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverStdoutLog -RedirectStandardError $serverStderrLog

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
