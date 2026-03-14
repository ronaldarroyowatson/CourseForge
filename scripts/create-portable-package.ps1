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

$defaultRepoOwner = "ronaldarroyowatson"
$defaultRepoName = "CourseForge"
$repoOwner = if ($env:COURSEFORGE_UPDATE_REPO_OWNER) { $env:COURSEFORGE_UPDATE_REPO_OWNER } else { $defaultRepoOwner }
$repoName = if ($env:COURSEFORGE_UPDATE_REPO_NAME) { $env:COURSEFORGE_UPDATE_REPO_NAME } else { $defaultRepoName }

Write-Host "[package] Building webapp..."
npm run build | Out-Host

Write-Host "[package] Building extension..."
npm run build:extension | Out-Host

$releaseRoot = Join-Path $repoRoot "release"
$packageName = "CourseForge-$Version-portable"
$packageDir = Join-Path $releaseRoot $packageName
$zipPath = Join-Path $releaseRoot "$packageName.zip"

if (Test-Path $packageDir) {
  Remove-Item $packageDir -Recurse -Force
}
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

New-Item -ItemType Directory -Path $packageDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDir "webapp") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDir "extension") | Out-Null

Copy-Item (Join-Path $repoRoot "dist/webapp/*") (Join-Path $packageDir "webapp") -Recurse -Force
Copy-Item (Join-Path $repoRoot "dist/extension/*") (Join-Path $packageDir "extension") -Recurse -Force

Copy-Item (Join-Path $repoRoot "README.md") $packageDir -Force
Copy-Item (Join-Path $repoRoot "LICENSE") $packageDir -Force
Copy-Item (Join-Path $repoRoot "CHANGELOG.md") $packageDir -Force

$updaterTemplatePath = Join-Path $PSScriptRoot "auto-update-portable.ps1"
if (-not (Test-Path $updaterTemplatePath)) {
  throw "Missing updater template: $updaterTemplatePath"
}
Copy-Item -Path $updaterTemplatePath -Destination (Join-Path $packageDir "AutoUpdate-CourseForge.ps1") -Force

$startCmd = @"
@echo off
setlocal
set ROOT=%~dp0
if exist "%ROOT%AutoUpdate-CourseForge.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%AutoUpdate-CourseForge.ps1" -CurrentVersion "$Version" -Owner "$repoOwner" -Repo "$repoName" >nul 2>&1
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
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%AutoUpdate-CourseForge.ps1" -CurrentVersion "$Version" -Owner "$repoOwner" -Repo "$repoName" -CheckOnly
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

$shortcutUrl = @"
[InternetShortcut]
URL=Start-CourseForge.cmd
IconFile=%SystemRoot%\System32\SHELL32.dll
IconIndex=220
"@
Set-Content -Path (Join-Path $packageDir "CourseForge-Start.url") -Value $shortcutUrl -Encoding ASCII

$manifest = [ordered]@{
  name = "CourseForge"
  version = $Version
  packageType = "portable"
  createdAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  includes = @(
    "webapp/",
    "extension/",
    "AutoUpdate-CourseForge.ps1",
    "Check-For-CourseForge-Updates.cmd",
    "Start-CourseForge.cmd",
    "CourseForge-Start.url",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  )
  updates = [ordered]@{
    provider = "github-releases"
    owner = $repoOwner
    repo = $repoName
    latestEndpoint = "https://api.github.com/repos/$repoOwner/$repoName/releases/latest"
    assetTemplate = "CourseForge-{version}-portable.zip"
    startupCheck = $true
  }
} | ConvertTo-Json -Depth 5
Set-Content -Path (Join-Path $packageDir "package-manifest.json") -Value $manifest -Encoding ASCII

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "[package] Portable package created: $zipPath"
Write-Host "[package] Launch file: $packageDir\Start-CourseForge.cmd"
