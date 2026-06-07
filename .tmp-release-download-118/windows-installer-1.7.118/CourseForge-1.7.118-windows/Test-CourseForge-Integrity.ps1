param(
  [string]$PackageRoot,
  [string]$OutputPath,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Write-IntegrityLog {
  param([string]$Message)
  if (-not $Quiet) {
    Write-Host "[integrity] $Message"
  }
}

function Get-RelativePath {
  param(
    [string]$BasePath,
    [string]$FullPath
  )

  $baseUri = [System.Uri]((Resolve-Path -LiteralPath $BasePath).Path + "\")
  $fullUri = [System.Uri](Resolve-Path -LiteralPath $FullPath).Path
  return $baseUri.MakeRelativeUri($fullUri).ToString().Replace('%20', ' ')
}

if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
  $PackageRoot = Split-Path -Parent $PSCommandPath
}

$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$manifestPath = Join-Path $PackageRoot "manifest.json"
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $PackageRoot "integrity-status.json"
}

if (-not (Test-Path -LiteralPath $manifestPath)) {
  $result = [ordered]@{
    ok = $false
    error = "manifest-missing"
    manifestPath = $manifestPath
    checkedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    missing = @()
    modified = @()
    corrupted = @()
    extras = @()
  }
  Set-Content -Path $OutputPath -Value ($result | ConvertTo-Json -Depth 6) -Encoding ASCII
  exit 2
}

$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
$fileIndex = @{}
foreach ($entry in $manifest.files) {
  $fileIndex[[string]$entry.path] = $entry
}

$missing = New-Object System.Collections.Generic.List[string]
$modified = New-Object System.Collections.Generic.List[string]
$corrupted = New-Object System.Collections.Generic.List[string]

foreach ($pathKey in $fileIndex.Keys) {
  $entry = $fileIndex[$pathKey]
  $absolutePath = Join-Path $PackageRoot ([string]$entry.path -replace '/', '\\')

  if (-not (Test-Path -LiteralPath $absolutePath)) {
    $missing.Add([string]$entry.path)
    continue
  }

  try {
    $actualLength = (Get-Item -LiteralPath $absolutePath).Length
    if ([Int64]$actualLength -ne [Int64]$entry.sizeBytes) {
      $modified.Add([string]$entry.path)
      continue
    }

    $actualHash = (Get-FileHash -Path $absolutePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne ([string]$entry.sha256).ToLowerInvariant()) {
      $corrupted.Add([string]$entry.path)
    }
  }
  catch {
    $corrupted.Add([string]$entry.path)
  }
}

$ignoreExtraPrefixes = @(
  "logs/",
  "user-data/",
  "ocr-cache/",
  "_pending_update/",
  "_rollback/"
)

$extras = New-Object System.Collections.Generic.List[string]
Get-ChildItem -Path $PackageRoot -File -Recurse -ErrorAction SilentlyContinue |
  ForEach-Object {
    $relativePath = Get-RelativePath -BasePath $PackageRoot -FullPath $_.FullName
    if ($relativePath -eq "manifest.json") {
      return
    }

    foreach ($prefix in $ignoreExtraPrefixes) {
      if ($relativePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return
      }
    }

    if (-not $fileIndex.ContainsKey($relativePath)) {
      $extras.Add($relativePath)
    }
  }

$ok = ($missing.Count -eq 0 -and $modified.Count -eq 0 -and $corrupted.Count -eq 0)
$result = [ordered]@{
  ok = $ok
  packageVersion = [string]$manifest.version
  requiredNodeVersion = [string]$manifest.requiredNodeVersion
  requiredConfigSchemaVersion = [string]$manifest.requiredConfigSchemaVersion
  requiredDatabaseSchemaVersion = [string]$manifest.requiredDatabaseSchemaVersion
  requiredExtensionSchemaVersion = [string]$manifest.requiredExtensionSchemaVersion
  checkedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  missing = $missing
  modified = $modified
  corrupted = $corrupted
  extras = $extras
  summary = [ordered]@{
    trackedFiles = $fileIndex.Keys.Count
    missing = $missing.Count
    modified = $modified.Count
    corrupted = $corrupted.Count
    extras = $extras.Count
  }
}

Set-Content -Path $OutputPath -Value ($result | ConvertTo-Json -Depth 8) -Encoding ASCII

if ($ok) {
  Write-IntegrityLog "Integrity check passed. tracked=$($fileIndex.Keys.Count)"
  exit 0
}

Write-IntegrityLog "Integrity check failed. missing=$($missing.Count) modified=$($modified.Count) corrupted=$($corrupted.Count) extras=$($extras.Count)"
exit 3
