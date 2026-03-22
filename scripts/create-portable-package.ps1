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

function New-CourseForgeIcon {
  param([string]$OutputPath)

  $svgSourcePath = Join-Path $repoRoot "src/webapp/public/placeholder-icons/coderabbit-placeholder.svg"
  $prebuiltIcoPath = Join-Path $repoRoot "src/assets/CourseForge.ico"

  if (-not (Test-Path $svgSourcePath)) {
    Write-Error "SVG source not found: $svgSourcePath"
    exit 1
  }

  $magickPath = Get-Command magick -ErrorAction SilentlyContinue
  if ($magickPath) {
    Write-Host "Converting SVG to ICO using ImageMagick..." -ForegroundColor Cyan
    & magick convert -background transparent -density 384 -define icon:auto-resize=256,128,96,64,48,32,16 $svgSourcePath $OutputPath
    if ($LASTEXITCODE -eq 0) {
      Write-Host "ICO generated from SVG successfully" -ForegroundColor Green
      return
    }
  }

  if (Test-Path $prebuiltIcoPath) {
    Write-Host "Using pre-built ICO file..." -ForegroundColor Cyan
    Copy-Item -Path $prebuiltIcoPath -Destination $OutputPath -Force
    Write-Host "ICO copied successfully" -ForegroundColor Green
    return
  }

  Write-Host "Generating fallback icon using System.Drawing..." -ForegroundColor Yellow
  Add-Type -AssemblyName System.Drawing

  $bitmap = New-Object System.Drawing.Bitmap 256, 256
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $navy = [System.Drawing.Color]::FromArgb(255, 24, 44, 72)
  $paper = [System.Drawing.Color]::FromArgb(255, 247, 239, 220)
  $bookBrush = New-Object System.Drawing.SolidBrush $navy
  $pageBrush = New-Object System.Drawing.SolidBrush $paper

  $graphics.FillRectangle($bookBrush, 30, 54, 196, 148)
  $graphics.FillRectangle($pageBrush, 52, 72, 152, 112)

  $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
  $stream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create)
  try {
    $icon.Save($stream)
    Write-Host "Fallback ICO generated successfully" -ForegroundColor Green
  }
  finally {
    $stream.Dispose()
    $graphics.Dispose()
    $bookBrush.Dispose()
    $pageBrush.Dispose()
    $icon.Dispose()
    $bitmap.Dispose()
  }
}

function New-PortableFileManifest {
  param(
    [string]$PackageRoot,
    [string]$Version,
    [string]$NodeRange,
    [string]$ConfigSchemaVersion,
    [string]$DbSchemaVersion,
    [string]$ExtensionSchemaVersion
  )

  $files = Get-ChildItem -Path $PackageRoot -File -Recurse -ErrorAction Stop |
    Where-Object {
      $_.Name -notin @("manifest.json")
    } |
    ForEach-Object {
      $relative = $_.FullName.Substring($PackageRoot.Length).TrimStart('\\').Replace('\\', '/')
      $hash = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      [ordered]@{
        path = $relative
        sizeBytes = [Int64]$_.Length
        sha256 = $hash
      }
    } |
    Sort-Object -Property path

  return [ordered]@{
    name = "CourseForge"
    version = $Version
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    dependencyVersions = [ordered]@{
      node = $NodeRange
    }
    requiredNodeVersion = $NodeRange
    requiredConfigSchemaVersion = $ConfigSchemaVersion
    requiredDatabaseSchemaVersion = $DbSchemaVersion
    requiredExtensionSchemaVersion = $ExtensionSchemaVersion
    files = $files
  }
}

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

$iconPath = Join-Path $packageDir "CourseForge.ico"
New-CourseForgeIcon -OutputPath $iconPath

$updaterTemplatePath = Join-Path $PSScriptRoot "auto-update-portable.ps1"
if (-not (Test-Path $updaterTemplatePath)) {
  throw "Missing updater template: $updaterTemplatePath"
}
Copy-Item -Path $updaterTemplatePath -Destination (Join-Path $packageDir "AutoUpdate-CourseForge.ps1") -Force

# Copy required support files for running the packaged launcher/server flow.
$supportFilesToCopy = @(
  "Start-CourseForge.ps1",
  "courseforge-serve.cjs",
  "courseforge-serve.js",
  "boot-splash.html",
  "Test-CourseForge-Integrity.ps1"
)
foreach ($file in $supportFilesToCopy) {
  $sourcePath = Join-Path (Join-Path $PSScriptRoot "installer") $file
  if (Test-Path $sourcePath) {
    Copy-Item -Path $sourcePath -Destination (Join-Path $packageDir $file) -Force
  } else {
    Write-Warning "Support file not found: $sourcePath"
  }
}

$startCmdTemplatePath = Join-Path (Join-Path $PSScriptRoot "installer") "Start-CourseForge.cmd"
if (Test-Path $startCmdTemplatePath) {
  Copy-Item -Path $startCmdTemplatePath -Destination (Join-Path $packageDir "Start-CourseForge.cmd") -Force
}
else {
  Write-Warning "Start launcher template not found: $startCmdTemplatePath. Falling back to minimal launcher wrapper."
  $startCmdFallback = @"
@echo off
setlocal
set SCRIPT_DIR=%~dp0
if not defined COURSEFORGE_DETACH_AFTER_READY set COURSEFORGE_DETACH_AFTER_READY=1
start "" cmd /c powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_DIR%Start-CourseForge.ps1"
exit /b %ERRORLEVEL%
"@
  Set-Content -Path (Join-Path $packageDir "Start-CourseForge.cmd") -Value $startCmdFallback -Encoding ASCII
}

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
IconFile=CourseForge.ico
IconIndex=0
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
    "Start-CourseForge.ps1",
    "courseforge-serve.cjs",
    "courseforge-serve.js",
    "boot-splash.html",
    "Test-CourseForge-Integrity.ps1",
    "CourseForge-Start.url",
    "CourseForge.ico",
    "manifest.json",
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

$nodeRange = if ($packageJson.engines.node) { [string]$packageJson.engines.node } else { ">=20 <25" }
$fileManifest = New-PortableFileManifest -PackageRoot $packageDir -Version $Version -NodeRange $nodeRange -ConfigSchemaVersion "1" -DbSchemaVersion "1" -ExtensionSchemaVersion "1"
Set-Content -Path (Join-Path $packageDir "manifest.json") -Value ($fileManifest | ConvertTo-Json -Depth 6) -Encoding ASCII

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "[package] Portable package created: $zipPath"
Write-Host "[package] Launch file: $packageDir\Start-CourseForge.cmd"
