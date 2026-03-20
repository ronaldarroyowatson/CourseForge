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

# Initialize log directory with fallback to temp dir
$logDir = $null
$launcherLog = $null
$serverStdoutLog = $null
$serverStderrLog = $null
$logInitialized = $false

try {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw "LOCALAPPDATA environment variable is not set."
  }
  $logDir = Join-Path $env:LOCALAPPDATA "CourseForge\logs"
  if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force -ErrorAction Stop | Out-Null
  }
  $launcherLog = Join-Path $logDir "launcher.log"
  $serverStdoutLog = Join-Path $logDir "server-stdout.log"
  $serverStderrLog = Join-Path $logDir "server-stderr.log"
  $logInitialized = $true
}
catch {
  # Fallback to temp directory if primary log dir fails
  Write-Host "Warning: Could not create log directory in LOCALAPPDATA. Using fallback temp directory."
  $logDir = Join-Path $env:TEMP "CourseForge-launcher"
  try {
    New-Item -ItemType Directory -Path $logDir -Force -ErrorAction Stop | Out-Null
    $launcherLog = Join-Path $logDir "launcher.log"
    $serverStdoutLog = Join-Path $logDir "server-stdout.log"
    $serverStderrLog = Join-Path $logDir "server-stderr.log"
    $logInitialized = $true
  }
  catch {
    Write-Host "Critical: Cannot initialize logging. Launcher will continue without logs."
  }
}

function Write-LauncherLog {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  if ($logInitialized -and -not [string]::IsNullOrWhiteSpace($launcherLog)) {
    try {
      Add-Content -Path $launcherLog -Value $line -Encoding ASCII -ErrorAction SilentlyContinue
    }
    catch {
      # Silently skip if log write fails
    }
  }
}

function New-SupportCode {
  return ([Guid]::NewGuid().ToString("N").Substring(0, 8).ToUpperInvariant())
}

function Get-OrphanedNodeFolders {
  $candidates = @(
    "C:\Program Files\nodejs",
    (Join-Path $scriptDir "node-runtime")
  )

  $orphans = @()
  foreach ($candidate in $candidates) {
    if ((Test-Path $candidate) -and -not (Test-Path (Join-Path $candidate "node.exe"))) {
      $orphans += $candidate
    }
  }

  return $orphans
}

function Get-NodeRuntimeHealth {
  param([string]$NodeExecutablePath)

  if ([string]::IsNullOrWhiteSpace($NodeExecutablePath) -or -not (Test-Path $NodeExecutablePath)) {
    return [ordered]@{
      healthy = $false
      reason = "Node runtime was not found."
      nodeVersion = $null
      npmVersion = $null
    }
  }

  try {
    $nodeVersion = (& $NodeExecutablePath -v 2>&1 | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($nodeVersion) -or -not $nodeVersion.StartsWith("v")) {
      return [ordered]@{
        healthy = $false
        reason = "node -v returned an unexpected value."
        nodeVersion = $nodeVersion
        npmVersion = $null
      }
    }

    $nodeRoot = Split-Path -Parent $NodeExecutablePath
    $npmCmdPath = Join-Path $nodeRoot "npm.cmd"
    if (-not (Test-Path $npmCmdPath)) {
      return [ordered]@{
        healthy = $false
        reason = "npm.cmd was not found next to node.exe."
        nodeVersion = $nodeVersion
        npmVersion = $null
      }
    }

    $npmVersion = (& $npmCmdPath -v 2>&1 | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($npmVersion)) {
      return [ordered]@{
        healthy = $false
        reason = "npm -v returned an empty value."
        nodeVersion = $nodeVersion
        npmVersion = $null
      }
    }

    return [ordered]@{
      healthy = $true
      reason = $null
      nodeVersion = $nodeVersion
      npmVersion = $npmVersion
    }
  }
  catch {
    return [ordered]@{
      healthy = $false
      reason = $_.Exception.Message
      nodeVersion = $null
      npmVersion = $null
    }
  }
}

function Write-RuntimeDiagnostics {
  param(
    [string]$NodeExecutablePath,
    [hashtable]$Health,
    [string[]]$OrphanedFolders
  )

  $pathSegments = @($env:Path -split ';' | Select-Object -First 12)
  $pathPreview = ($pathSegments -join ';')
  $osVersion = [System.Environment]::OSVersion.VersionString
  $runtimeState = if ($Health.healthy) { "healthy" } else { "unhealthy" }

  Write-LauncherLog "Runtime diagnostics: state=$runtimeState nodePath=$NodeExecutablePath nodeVersion=$($Health.nodeVersion) npmVersion=$($Health.npmVersion) os=$osVersion"
  Write-LauncherLog "Runtime diagnostics PATH preview: $pathPreview"

  if ($OrphanedFolders.Count -gt 0) {
    Write-LauncherLog "Runtime diagnostics orphaned node folders: $($OrphanedFolders -join ', ')"
  }
}

function Show-RuntimeFailureAndExit {
  param([string]$Reason)

  $supportCode = New-SupportCode
  Write-LauncherLog "ERROR: Runtime sanity check failed: $Reason (support code: $supportCode)"
  Write-Host "We couldn't set up the runtime automatically. Please contact support with this code: $supportCode"
  exit 1
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
    Write-Host ""
    Write-Host "CourseForge requires Node.js to run. The bundled runtime is missing and no system Node.js was detected."
    Write-Host "Please run the installer again to repair the installation."
    exit 1
  }

  $nodePath = $nodeExe.Source
  Write-LauncherLog "Using system Node runtime: $nodePath"
}

$runtimeHealth = Get-NodeRuntimeHealth -NodeExecutablePath $nodePath
$orphanedNodeFolders = Get-OrphanedNodeFolders
Write-RuntimeDiagnostics -NodeExecutablePath $nodePath -Health $runtimeHealth -OrphanedFolders $orphanedNodeFolders

if (-not $runtimeHealth.healthy) {
  $runtimeFailureReason = if ([string]::IsNullOrWhiteSpace($runtimeHealth.reason)) {
    "Unknown Node runtime validation failure."
  }
  else {
    $runtimeHealth.reason
  }
  Show-RuntimeFailureAndExit -Reason $runtimeFailureReason
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

function Get-ListeningProcessForPort {
  param([int]$Port)

  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
  }
  catch {
    return $null
  }

  if ($null -eq $connection) {
    return $null
  }

  try {
    return Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $connection.OwningProcess) -ErrorAction Stop | Select-Object -First 1
  }
  catch {
    return $null
  }
}

function Find-AvailableLocalPort {
  param(
    [int]$StartPort,
    [int]$MaxAttempts = 200
  )

  $candidate = [Math]::Max(1024, $StartPort)
  for ($attempt = 0; $attempt -lt $MaxAttempts; $attempt++) {
    if (Test-PortAvailable -TargetHost $hostName -Port $candidate) {
      return $candidate
    }
    $candidate++
  }

  return $null
}

function Prompt-CloseOldCourseForgeServer {
  param(
    [string]$Message,
    [int]$TimeoutSeconds = 15
  )

  # Allow silent automation to skip interactive prompts.
  if ($env:COURSEFORGE_DISABLE_OLD_SERVER_PROMPT -eq "1") {
    return $false
  }

  try {
    $shell = New-Object -ComObject WScript.Shell
    $promptResult = $shell.Popup($Message, $TimeoutSeconds, "CourseForge Startup", 4 + 32)
    # 6 = Yes, 7 = No, -1 = timeout
    return ($promptResult -eq 6)
  }
  catch {
    Write-LauncherLog "WARNING: Could not display old-server prompt. Continuing without interactive confirmation."
    return $false
  }
}

function Stop-StaleCourseForgeServerOnPort {
  param(
    [int]$Port,
    [string]$ExpectedRoot
  )

  $process = Get-ListeningProcessForPort -Port $Port
  if ($null -eq $process) {
    return $false
  }

  $commandLine = [string]$process.CommandLine
  if ([string]::IsNullOrWhiteSpace($commandLine)) {
    return $false
  }

  $isCourseForgeServer = $commandLine -match "courseforge-serve\.js"
  $isExpectedInstall = $commandLine -match [regex]::Escape($ExpectedRoot)
  if (-not $isCourseForgeServer -or $isExpectedInstall) {
    return $false
  }

  Write-LauncherLog "Detected stale CourseForge server on port $Port (PID=$($process.ProcessId)) from a different install path. Stopping it to avoid version conflicts."
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    Start-Sleep -Milliseconds 400
    return $true
  }
  catch {
    Write-LauncherLog "WARNING: Failed to stop stale CourseForge server PID=$($process.ProcessId). $($_.Exception.Message)"
    return $false
  }
}

function Get-CourseForgeServerVersion {
  param([string]$BaseUrl)

  $statusUrl = "$BaseUrl/api/update-status"
  try {
    $response = Invoke-WebRequest -Uri $statusUrl -UseBasicParsing -Method Get -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $payload = $response.Content | ConvertFrom-Json
      if ($null -ne $payload -and ($payload.PSObject.Properties.Name -contains "currentVersion")) {
        return [string]$payload.currentVersion
      }
    }
  }
  catch {
    # Best effort.
  }

  return $null
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

function Test-CourseForgeServerReady {
  param(
    [string]$BaseUrl,
    [int]$TimeoutSeconds = 5,
    [int]$PollMilliseconds = 250
  )

  $statusUrl = "$BaseUrl/api/update-status"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $statusUrl -UseBasicParsing -Method Get -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $payload = $response.Content | ConvertFrom-Json
        if ($null -ne $payload -and ($payload.PSObject.Properties.Name -contains "currentVersion")) {
          return $true
        }
      }
    }
    catch {
      # Keep polling until timeout.
    }

    Start-Sleep -Milliseconds $PollMilliseconds
  }

  return $false
}

function Test-CourseForgeUpdateApiReady {
  param(
    [string]$BaseUrl,
    [int]$TimeoutSeconds = 3,
    [int]$PollMilliseconds = 250
  )

  $statusUrl = "$BaseUrl/api/updater-progress"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $statusUrl -UseBasicParsing -Method Get -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $payload = $response.Content | ConvertFrom-Json
        if ($null -ne $payload -and ($payload.PSObject.Properties.Name -contains "state")) {
          return $true
        }
      }
    }
    catch {
      # Keep polling until timeout.
    }

    Start-Sleep -Milliseconds $PollMilliseconds
  }

  return $false
}

function Open-CourseForgeUrl {
  param([string]$Url)

  if ($env:COURSEFORGE_DISABLE_AUTO_BROWSER -eq "1") {
    Write-LauncherLog "Auto browser launch disabled by COURSEFORGE_DISABLE_AUTO_BROWSER=1. URL: $Url"
    return
  }

  try {
    Start-Process $Url
  }
  catch {
    Write-LauncherLog "WARNING: Could not open browser automatically. Please navigate to $Url"
  }
}

# Prefer localhost:$port, but allow adaptive fallback when occupied.

try {
  $activePort = $port
  $url = "http://${hostName}:$activePort"

  if (-not (Test-PortAvailable -TargetHost $hostName -Port $activePort)) {
    $listeningProcess = Get-ListeningProcessForPort -Port $activePort
    $processCommandLine = if ($null -ne $listeningProcess) { [string]$listeningProcess.CommandLine } else { "" }
    $isCourseForgeProcess = -not [string]::IsNullOrWhiteSpace($processCommandLine) -and $processCommandLine -match "courseforge-serve\.js"
    $isExpectedInstall = $isCourseForgeProcess -and $processCommandLine -match [regex]::Escape($scriptDir)

    if (Test-CourseForgeServerReady -BaseUrl $url -TimeoutSeconds 3) {
      if ($isExpectedInstall) {
        $supportsUpdateApi = Test-CourseForgeUpdateApiReady -BaseUrl $url -TimeoutSeconds 2
        if (-not $supportsUpdateApi) {
          Write-LauncherLog "Detected an older in-memory CourseForge server on $url that does not expose updater-progress API. Restarting server to load current install files."
          try {
            Stop-Process -Id $listeningProcess.ProcessId -Force -ErrorAction Stop
            Start-Sleep -Milliseconds 600
          }
          catch {
            Write-LauncherLog "WARNING: Failed to stop outdated CourseForge server PID=$($listeningProcess.ProcessId). $($_.Exception.Message)"
          }
        }
      }

      if ($isCourseForgeProcess -and -not $isExpectedInstall) {
        $existingVersion = Get-CourseForgeServerVersion -BaseUrl $url
        $versionLabel = if ([string]::IsNullOrWhiteSpace($existingVersion)) { "unknown" } else { $existingVersion }
        $closeMessage = "An older CourseForge instance (version $versionLabel) is already using port $activePort from another install path.`n`nChoose Yes to close it and continue on port $activePort.`nChoose No to keep it running and launch this session on another available local port."
        $shouldCloseOldServer = Prompt-CloseOldCourseForgeServer -Message $closeMessage

        if ($shouldCloseOldServer) {
          Write-LauncherLog "User chose to close old CourseForge server on port $activePort (PID=$($listeningProcess.ProcessId))."
          try {
            Stop-Process -Id $listeningProcess.ProcessId -Force -ErrorAction Stop
            Start-Sleep -Milliseconds 600
          }
          catch {
            Write-LauncherLog "WARNING: Could not stop old CourseForge server PID=$($listeningProcess.ProcessId). $($_.Exception.Message)"
          }
        }
      }

      if (-not (Test-PortAvailable -TargetHost $hostName -Port $activePort)) {
        $existingVersion = Get-CourseForgeServerVersion -BaseUrl $url
        if ($isExpectedInstall -or -not $isCourseForgeProcess) {
          if ([string]::IsNullOrWhiteSpace($existingVersion)) {
            Write-LauncherLog "Existing CourseForge server detected at $url. Reusing running server."
          }
          else {
            Write-LauncherLog "Existing CourseForge server detected at $url (version=$existingVersion). Reusing running server."
          }
          Open-CourseForgeUrl -Url $url
          exit 0
        }
      }
    }

    if (-not (Test-PortAvailable -TargetHost $hostName -Port $activePort)) {
      $fallbackPort = Find-AvailableLocalPort -StartPort ($activePort + 1)
      if ($null -eq $fallbackPort) {
        Write-LauncherLog "ERROR: Preferred port $activePort is busy and no fallback local port could be found."
        exit 1
      }

      Write-LauncherLog "Preferred port $activePort is busy. Falling back to available local port $fallbackPort."
      $activePort = $fallbackPort
      $url = "http://${hostName}:$activePort"
    }
  }

  # Start server in background
  Write-LauncherLog "Starting local server on port $activePort."

  foreach ($serverLogPath in @($serverStdoutLog, $serverStderrLog)) {
    if (Test-Path $serverLogPath) {
      Clear-Content -Path $serverLogPath -ErrorAction SilentlyContinue
    }
  }

  $serverProcess = Start-Process -FilePath $nodePath -ArgumentList @("`"$serverScript`"", "`"$webappDir`"", $activePort, "`"$hostName`"") -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverStdoutLog -RedirectStandardError $serverStderrLog

  # Check if process started successfully
  if ($serverProcess.HasExited) {
    Write-LauncherLog "ERROR: Failed to start server. The process exited immediately."
    $stderrText = if (Test-Path $serverStderrLog) { (Get-Content -Path $serverStderrLog -Raw -ErrorAction SilentlyContinue).Trim() } else { "" }
    if (-not [string]::IsNullOrWhiteSpace($stderrText)) {
      Write-LauncherLog "Server error details: $stderrText"
    }
    exit 1
  }

  $deadline = (Get-Date).AddSeconds(30)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ($serverProcess.HasExited) {
      $stderrText = if (Test-Path $serverStderrLog) { (Get-Content -Path $serverStderrLog -Raw -ErrorAction SilentlyContinue).Trim() } else { "" }
      $portRaceDetected = -not [string]::IsNullOrWhiteSpace($stderrText) -and $stderrText -match "already in use"
      if ($portRaceDetected -and (Test-CourseForgeServerReady -BaseUrl $url -TimeoutSeconds 3)) {
        Write-LauncherLog "Detected an existing CourseForge server after port race on $url. Reusing running server."
        Open-CourseForgeUrl -Url $url
        exit 0
      }

      if ([string]::IsNullOrWhiteSpace($stderrText)) {
        Write-LauncherLog "ERROR: Local server exited early with code $($serverProcess.ExitCode)."
      }
      else {
        $portInUseMessage = if ($portRaceDetected) {
          " Another process is holding CourseForge's preferred port $activePort. Close any other local server on that port and try again."
        }
        else {
          ""
        }
        Write-LauncherLog "ERROR: Local server exited early with code $($serverProcess.ExitCode). Details: $stderrText$portInUseMessage"
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
  Open-CourseForgeUrl -Url $url

  # Keep PowerShell window open
  Write-Host ""
  Write-Host "[CourseForge] Server is running. Close this window to stop the server."
  Write-Host "[CourseForge] Access the app at: $url"
  if ($logInitialized -and -not [string]::IsNullOrWhiteSpace($launcherLog)) {
    Write-Host "[CourseForge] Launcher log: $launcherLog"
  }
  Write-Host ""

  # Wait for user to close the window or process to exit
  while (-not $serverProcess.HasExited) {
    Start-Sleep -Seconds 1
  }

  Write-LauncherLog "Server stopped."
}
catch {
  $errorMsg = $_.Exception.Message
  $errorLine = $_.InvocationInfo.ScriptLineNumber
  Write-Host ""
  Write-Host "[CourseForge ERROR] An unexpected error occurred at line $errorLine"
  Write-Host "[CourseForge ERROR] $errorMsg"
  Write-LauncherLog "CRITICAL: Unexpected error at line $errorLine : $errorMsg"
  Write-Host ""
  Write-Host "Please contact support with the error details above."
  if ($logInitialized -and -not [string]::IsNullOrWhiteSpace($launcherLog)) {
    Write-Host "See $launcherLog for more details."
  }
  exit 1
}
