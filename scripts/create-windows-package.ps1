param(
  [string]$Version
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$packageJsonPath = Join-Path $repoRoot "package.json"
$packageJson = Get-Content -Path $packageJsonPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = $packageJson.version
}

$releaseRoot = Join-Path $repoRoot "release"
$portableName = "CourseForge-$Version-portable"
$portableDir = Join-Path $releaseRoot $portableName

if (-not (Test-Path $portableDir)) {
  Write-Host "[package] Portable package missing; generating first..."
  & (Join-Path $PSScriptRoot "create-portable-package.ps1") -Version $Version
}

$packageName = "CourseForge-$Version-windows"
$packageDir = Join-Path $releaseRoot $packageName
$zipPath = Join-Path $releaseRoot "$packageName.zip"

if (Test-Path $packageDir) {
  Remove-Item $packageDir -Recurse -Force
}
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

Copy-Item -Path $portableDir -Destination $packageDir -Recurse -Force

$startCmd = @"
@echo off
setlocal
set ROOT=%~dp0
if exist "%ROOT%AutoUpdate-CourseForge.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%AutoUpdate-CourseForge.ps1" -CurrentVersion "$Version" -AssetNameTemplate "CourseForge-{version}-windows.zip" >nul 2>&1
)
set APP=%ROOT%webapp\index.html
if not exist "%APP%" (
  echo [CourseForge] Missing webapp\index.html in package.
  exit /b 1
)
start "CourseForge" "%APP%"
"@
Set-Content -Path (Join-Path $packageDir "Start-CourseForge.cmd") -Value $startCmd -Encoding ASCII

$checkUpdatesCmd = @"
@echo off
setlocal
set ROOT=%~dp0
if not exist "%ROOT%AutoUpdate-CourseForge.ps1" (
  echo [CourseForge] Missing AutoUpdate-CourseForge.ps1 in package.
  endlocal
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%AutoUpdate-CourseForge.ps1" -CurrentVersion "$Version" -AssetNameTemplate "CourseForge-{version}-windows.zip" -CheckOnly
set EXITCODE=%ERRORLEVEL%
if "%EXITCODE%"=="2" (
  echo Update available.
  endlocal
  exit /b 0
)
if "%EXITCODE%"=="0" (
  echo No update available.
  endlocal
  exit /b 0
)
echo Update check failed.
endlocal
exit /b 1
"@
Set-Content -Path (Join-Path $packageDir "Check-For-CourseForge-Updates.cmd") -Value $checkUpdatesCmd -Encoding ASCII

$installerTemplatePath = Join-Path $repoRoot "scripts/installer/windows-installer-template.ps1"
if (-not (Test-Path $installerTemplatePath)) {
  throw "Installer template not found: $installerTemplatePath"
}

$installerPs1 = Get-Content -Path $installerTemplatePath -Raw
$installerPs1 = $installerPs1.Replace("__COURSEFORGE_VERSION__", $Version)
Set-Content -Path (Join-Path $packageDir "Install-CourseForge-Windows.ps1") -Value $installerPs1 -Encoding ASCII

$installerCmd = @"
@echo off
setlocal
set ROOT=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%Install-CourseForge-Windows.ps1" %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo [CourseForge] Installation failed with code %EXITCODE%.
  exit /b %EXITCODE%
)
echo [CourseForge] Installation completed.
exit /b 0
"@
Set-Content -Path (Join-Path $packageDir "Install-CourseForge-Windows.cmd") -Value $installerCmd -Encoding ASCII

$uninstallerCmd = @"
@echo off
setlocal
set ROOT=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%Install-CourseForge-Windows.ps1" -Uninstall %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo [CourseForge] Uninstall failed with code %EXITCODE%.
  exit /b %EXITCODE%
)
echo [CourseForge] Uninstall completed.
exit /b 0
"@
Set-Content -Path (Join-Path $packageDir "Uninstall-CourseForge-Windows.cmd") -Value $uninstallerCmd -Encoding ASCII

$manifestPath = Join-Path $packageDir "package-manifest.json"
$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
$manifest.packageType = "windows"
$manifest.includes = @(
  "webapp/",
  "extension/",
  "AutoUpdate-CourseForge.ps1",
  "Check-For-CourseForge-Updates.cmd",
  "Start-CourseForge.cmd",
  "CourseForge-Start.url",
  "Install-CourseForge-Windows.ps1",
  "Install-CourseForge-Windows.cmd",
  "Uninstall-CourseForge-Windows.cmd",
  "installer-integrity.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE"
)
$manifest.updates.assetTemplate = "CourseForge-{version}-windows.zip"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding ASCII

$integrityFiles = @(
  "AutoUpdate-CourseForge.ps1",
  "Check-For-CourseForge-Updates.cmd",
  "Start-CourseForge.cmd",
  "Install-CourseForge-Windows.ps1",
  "Install-CourseForge-Windows.cmd",
  "Uninstall-CourseForge-Windows.cmd",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "package-manifest.json",
  "webapp/index.html",
  "extension/manifest.json"
)

$integrityEntries = @()
foreach ($relative in $integrityFiles) {
  $targetPath = Join-Path $packageDir $relative
  if (Test-Path $targetPath) {
    $hash = (Get-FileHash -Path $targetPath -Algorithm SHA256).Hash
    $integrityEntries += [ordered]@{
      path = $relative
      hash = $hash
    }
  }
}

$integrityManifest = [ordered]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  version = $Version
  files = $integrityEntries
}

$integrityManifest | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $packageDir "installer-integrity.json") -Encoding ASCII

$zipSucceeded = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
  try {
    Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
    $zipSucceeded = $true
    break
  }
  catch {
    if ($attempt -ge 3) {
      throw
    }

    Start-Sleep -Seconds 1
    if (Test-Path $zipPath) {
      Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    }
  }
}

if (-not $zipSucceeded) {
  throw "Failed to create Windows package zip: $zipPath"
}

Write-Host "[package] Windows package created: $zipPath"
Write-Host "[package] Installer file: $packageDir\Install-CourseForge-Windows.cmd"
