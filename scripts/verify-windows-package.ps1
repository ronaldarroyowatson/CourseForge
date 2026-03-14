param(
  [string]$Version
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJsonPath = Join-Path $repoRoot "package.json"
$packageJson = Get-Content -Path $packageJsonPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = $packageJson.version
}

$releaseRoot = Join-Path $repoRoot "release"
$packageName = "CourseForge-$Version-windows"
$packageDir = Join-Path $releaseRoot $packageName
$zipPath = Join-Path $releaseRoot "$packageName.zip"

$required = @(
  "webapp/index.html",
  "extension/manifest.json",
  "extension/background.js",
  "AutoUpdate-CourseForge.ps1",
  "Check-For-CourseForge-Updates.cmd",
  "Start-CourseForge.cmd",
  "Install-CourseForge-Windows.ps1",
  "Install-CourseForge-Windows.cmd",
  "package-manifest.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE"
)

if (-not (Test-Path $packageDir)) {
  throw "Package directory not found: $packageDir"
}

if (-not (Test-Path $zipPath)) {
  throw "Package zip not found: $zipPath"
}

foreach ($relative in $required) {
  $target = Join-Path $packageDir $relative
  if (-not (Test-Path $target)) {
    throw "Missing required packaged file: $relative"
  }

  if ((Get-Item $target).PSIsContainer -eq $false -and (Get-Item $target).Length -le 0) {
    throw "Packaged file is empty: $relative"
  }
}

$zipSize = (Get-Item $zipPath).Length
if ($zipSize -le 0) {
  throw "Zip artifact is empty: $zipPath"
}

$manifestPath = Join-Path $packageDir "package-manifest.json"
$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
if ($manifest.packageType -ne "windows") {
  throw "Unexpected package type for Windows package: $($manifest.packageType)"
}

if (-not $manifest.updates) {
  throw "package-manifest.json is missing updates metadata."
}

if ($manifest.updates.assetTemplate -ne "CourseForge-{version}-windows.zip") {
  throw "Unexpected updates.assetTemplate value: $($manifest.updates.assetTemplate)"
}

Write-Host "[verify] Windows package looks complete."
Write-Host "[verify] Checked files: $($required.Count)"
Write-Host "[verify] Zip size (bytes): $zipSize"
