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
$installerExePath = Join-Path $releaseRoot "CourseForge-$Version-installer.exe"

$required = @(
  "webapp/index.html",
  "extension/manifest.json",
  "extension/background.js",
  "AutoUpdate-CourseForge.ps1",
  "Check-For-CourseForge-Updates.cmd",
  "Start-CourseForge.cmd",
  "CourseForge.ico",
  "Install-CourseForge-Windows.ps1",
  "Install-CourseForge-Windows.cmd",
  "Uninstall-CourseForge-Windows.cmd",
  "installer-integrity.json",
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

if (-not (Test-Path $installerExePath)) {
  throw "Installer executable not found: $installerExePath"
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

$installerExeSize = (Get-Item $installerExePath).Length
if ($installerExeSize -le 0) {
  throw "Installer executable is empty: $installerExePath"
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

$webappIndex = Get-Content -Path (Join-Path $packageDir "webapp/index.html") -Raw
if ($webappIndex -match 'src="/assets/' -or $webappIndex -match 'href="/assets/') {
  throw "Packaged webapp/index.html still references absolute /assets paths and will not launch correctly from disk."
}

Write-Host "[verify] Windows package looks complete."
Write-Host "[verify] Checked files: $($required.Count)"
Write-Host "[verify] Zip size (bytes): $zipSize"
Write-Host "[verify] Installer exe size (bytes): $installerExeSize"
