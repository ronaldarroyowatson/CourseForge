[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseApprovedVerbs', '', Scope = 'Function', Target = 'Parse-SemVer', Justification = 'Legacy function name removed; suppress stale analyzer warning in editor cache.')]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseApprovedVerbs', '', Scope = 'Function', Target = '*', Justification = 'Updater helper names use approved verbs; suppress false positives from stale diagnostics.')]
param(
  [string]$PackageRoot,
  [string]$CurrentVersion,
  [string]$Owner = "ronaldarroyowatson",
  [string]$Repo = "CourseForge",
  [string]$AssetNameTemplate = "CourseForge-{version}-portable.zip",
  [string]$LatestReleaseJsonPath,
  [switch]$CheckOnly,
  [switch]$StageOnly,
  [int]$TimeoutSec = 20
)

$ErrorActionPreference = "Stop"

function Write-UpdateLog {
  param(
    [string]$LogPath,
    [string]$Message
  )

  $line = "[{0}] {1}" -f (Get-Date).ToString("s"), $Message
  Add-Content -Path $LogPath -Value $line -Encoding ASCII
}

function Write-UpdateError {
  param(
    [string]$LogPath,
    [System.Management.Automation.ErrorRecord]$ErrorRecord,
    [string]$Prefix = "updater error"
  )

  if ($null -eq $ErrorRecord) {
    return
  }

  $message = $ErrorRecord.Exception.Message
  if (-not [string]::IsNullOrWhiteSpace($ErrorRecord.ScriptStackTrace)) {
    $stack = $ErrorRecord.ScriptStackTrace -replace '\r?\n', ' => '
    $message = "$message | stack: $stack"
  }

  Write-UpdateLog -LogPath $LogPath -Message "${Prefix}: $message"
}

function ConvertTo-VersionObject {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  $match = [regex]::Match($Value, "(\d+)\.(\d+)\.(\d+)")
  if (-not $match.Success) {
    return $null
  }

  return [version]("{0}.{1}.{2}" -f $match.Groups[1].Value, $match.Groups[2].Value, $match.Groups[3].Value)
}

function Resolve-ExtractRoot {
  param([string]$ExtractDir)

  $entries = Get-ChildItem -Path $ExtractDir -Force
  if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
    $singleDir = $entries[0].FullName
    if (Test-Path (Join-Path $singleDir "webapp\index.html")) {
      return $singleDir
    }
  }

  return $ExtractDir
}

function Resolve-PackageRoot {
  param([string]$InputRoot)

  if ([string]::IsNullOrWhiteSpace($InputRoot)) {
    return Split-Path -Parent $PSCommandPath
  }

  $trimmedRoot = $InputRoot.Trim().Trim('"')
  if ([string]::IsNullOrWhiteSpace($trimmedRoot)) {
    return Split-Path -Parent $PSCommandPath
  }

  $trimmedRoot = $trimmedRoot.TrimEnd('\\')
  if ([string]::IsNullOrWhiteSpace($trimmedRoot)) {
    return Split-Path -Parent $PSCommandPath
  }

  try {
    return (Resolve-Path -LiteralPath $trimmedRoot).Path
  }
  catch {
    return $trimmedRoot
  }
}

try {
  $resolvedRoot = Resolve-PackageRoot -InputRoot $PackageRoot
  $logPath = Join-Path $resolvedRoot "updater.log"
  $mode = if ($CheckOnly) { "check-only" } elseif ($StageOnly) { "stage-only" } else { "apply-now" }

  Write-UpdateLog -LogPath $logPath -Message "Updater start. Mode=$mode Root=$resolvedRoot CurrentVersion=$CurrentVersion AssetTemplate=$AssetNameTemplate"

  if ([string]::IsNullOrWhiteSpace($CurrentVersion)) {
    $manifestPath = Join-Path $resolvedRoot "package-manifest.json"
    if (Test-Path $manifestPath) {
      try {
        $manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
        $CurrentVersion = $manifest.version
        Write-UpdateLog -LogPath $logPath -Message "Loaded current version '$CurrentVersion' from package-manifest.json"
      }
      catch {
        Write-UpdateError -LogPath $logPath -ErrorRecord $_ -Prefix "Failed to read package-manifest.json"
      }
    }
  }

  $currentVersion = ConvertTo-VersionObject $CurrentVersion
  if ($null -eq $currentVersion) {
    Write-UpdateLog -LogPath $logPath -Message "Update check skipped: invalid current version '$CurrentVersion'."
    exit 0
  }

  $headers = @{ "User-Agent" = "CourseForge-Updater" }
  $token = if ($env:COURSEFORGE_GITHUB_TOKEN) { $env:COURSEFORGE_GITHUB_TOKEN } else { $env:GITHUB_TOKEN }
  if (-not [string]::IsNullOrWhiteSpace($token)) {
    $headers["Authorization"] = "Bearer $token"
  }

  if (-not [string]::IsNullOrWhiteSpace($LatestReleaseJsonPath)) {
    $release = Get-Content -Path $LatestReleaseJsonPath -Raw | ConvertFrom-Json
  }
  else {
    $latestUrl = "https://api.github.com/repos/$Owner/$Repo/releases/latest"
    Write-UpdateLog -LogPath $logPath -Message "Requesting latest release metadata from $latestUrl"
    $release = Invoke-RestMethod -Uri $latestUrl -Headers $headers -Method Get -TimeoutSec $TimeoutSec
  }

  $latestRawVersion = if ($release.tag_name) { $release.tag_name } else { $release.name }
  $latestVersion = ConvertTo-VersionObject $latestRawVersion
  if ($null -eq $latestVersion) {
    Write-UpdateLog -LogPath $logPath -Message "Update check skipped: latest release has no semantic version."
    exit 0
  }

  if ($latestVersion -le $currentVersion) {
    Write-UpdateLog -LogPath $logPath -Message "No update found. Current=$currentVersion Latest=$latestVersion"
    exit 0
  }

  if ($CheckOnly) {
    Write-Host "Update available: $latestVersion"
    Write-UpdateLog -LogPath $logPath -Message "Update available in check-only mode. Current=$currentVersion Latest=$latestVersion"
    exit 2
  }

  $targetAssetName = $AssetNameTemplate.Replace("{version}", $latestVersion.ToString())
  $asset = $release.assets | Where-Object { $_.name -eq $targetAssetName } | Select-Object -First 1
  if ($null -eq $asset) {
    Write-UpdateLog -LogPath $logPath -Message "Update found but asset '$targetAssetName' is missing in latest release."
    exit 0
  }

  Write-UpdateLog -LogPath $logPath -Message "Update available. Current=$currentVersion Latest=$latestVersion Asset=$($asset.name)"

  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("CourseForgeUpdate_" + [Guid]::NewGuid().ToString("N"))
  $zipPath = Join-Path $tempRoot $asset.name
  $extractDir = Join-Path $tempRoot "extracted"

  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  New-Item -ItemType Directory -Path $extractDir | Out-Null

  Write-UpdateLog -LogPath $logPath -Message "Downloading asset to $zipPath"
  Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $zipPath -TimeoutSec 120
  Write-UpdateLog -LogPath $logPath -Message "Expanding archive into $extractDir"
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

  $sourceRoot = Resolve-ExtractRoot -ExtractDir $extractDir
  $sourceWebapp = Join-Path $sourceRoot "webapp\index.html"
  if (-not (Test-Path $sourceWebapp)) {
    Write-UpdateLog -LogPath $logPath -Message "Downloaded update is missing webapp/index.html."
    Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
  }

  # ── Stage-only mode: copy to _pending_update/ for clean apply on next launch ──
  if ($StageOnly) {
    $pendingDir = Join-Path $resolvedRoot "_pending_update"
    Write-UpdateLog -LogPath $logPath -Message "Staging update into $pendingDir"
    if (Test-Path $pendingDir) {
      Remove-Item -Path $pendingDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $pendingDir | Out-Null

    $null = robocopy $sourceRoot $pendingDir /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    $robocopyExitCode = $LASTEXITCODE

    Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue

    if ($robocopyExitCode -gt 7) {
      Write-UpdateLog -LogPath $logPath -Message "Staging failed (robocopy exit $robocopyExitCode). Pending dir removed."
      Remove-Item -Path $pendingDir -Recurse -Force -ErrorAction SilentlyContinue
      exit 0
    }

    $pendingInfo = [ordered]@{
      version          = $latestVersion.ToString()
      currentVersion   = $currentVersion.ToString()
      assetName        = $asset.name
      releaseUrl       = if ($release.html_url) { $release.html_url } else { "" }
      stagedAt         = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json -Depth 2
    Set-Content -Path (Join-Path $resolvedRoot "pending-update.json") -Value $pendingInfo -Encoding ASCII

    Write-UpdateLog -LogPath $logPath -Message "Staged update $currentVersion -> $latestVersion in _pending_update/"
    exit 0
  }

  # ── Immediate apply (manual / CI use) ──
  $null = robocopy $sourceRoot $resolvedRoot /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XF updater.log /XF pending-update.json /XD _pending_update
  $robocopyExitCode = $LASTEXITCODE

  Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue

  if ($robocopyExitCode -gt 7) {
    Write-UpdateLog -LogPath $logPath -Message "Robocopy failed with exit code $robocopyExitCode"
    exit 0
  }

  Write-UpdateLog -LogPath $logPath -Message "Updated from $currentVersion to $latestVersion"
  Write-Host "CourseForge updated to $latestVersion"
  exit 0
}
catch {
  $safeRoot = Resolve-PackageRoot -InputRoot $PackageRoot
  $safeLogPath = Join-Path $safeRoot "updater.log"
  Write-UpdateError -LogPath $safeLogPath -ErrorRecord $_

  exit 0
}
