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
$installerExePath = Join-Path $releaseRoot "CourseForge-$Version-installer.exe"
$bootstrapDir = Join-Path $releaseRoot ".windows-installer-bootstrap-$Version"
$bootstrapZipName = "CourseForge-windows-payload.zip"
$bootstrapLauncherName = "Launch-CourseForge-Installer.cmd"
$iexpressSedPath = Join-Path $releaseRoot ".windows-installer-$Version.sed"

if (Test-Path $packageDir) {
  Remove-Item $packageDir -Recurse -Force
}
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}
if (Test-Path $installerExePath) {
  Remove-Item $installerExePath -Force
}
if (Test-Path $bootstrapDir) {
  Remove-Item $bootstrapDir -Recurse -Force
}
if (Test-Path $iexpressSedPath) {
  Remove-Item $iexpressSedPath -Force
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

New-Item -ItemType Directory -Path $bootstrapDir | Out-Null
Copy-Item -Path $zipPath -Destination (Join-Path $bootstrapDir $bootstrapZipName) -Force

$bootstrapLauncher = @"
@echo off
setlocal
set ROOT=%~dp0
set PAYLOAD=%ROOT%$bootstrapZipName
set WORK=%TEMP%\CourseForge-Installer-%RANDOM%%RANDOM%
set EXTRACT=%WORK%\payload
set INSTALLER=%EXTRACT%\Install-CourseForge-Windows.ps1
set INTERACTIVE=0
if "%~1"=="" set INTERACTIVE=1
if exist "%WORK%" rmdir /s /q "%WORK%" >nul 2>&1
mkdir "%EXTRACT%" >nul 2>&1
if not exist "%PAYLOAD%" (
  echo [CourseForge] Missing installer payload archive.
  if "%INTERACTIVE%"=="1" pause
  endlocal
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%PAYLOAD%' -DestinationPath '%EXTRACT%' -Force"
if errorlevel 1 (
  echo [CourseForge] Failed to extract installer payload.
  rmdir /s /q "%WORK%" >nul 2>&1
  if "%INTERACTIVE%"=="1" pause
  endlocal
  exit /b 1
)
if not exist "%INSTALLER%" (
  echo [CourseForge] Missing extracted installer script.
  rmdir /s /q "%WORK%" >nul 2>&1
  if "%INTERACTIVE%"=="1" pause
  endlocal
  exit /b 1
)
set INSTALL_ARGS=%*
if "%INSTALL_ARGS%"=="" set INSTALL_ARGS=-FullAuto
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" %INSTALL_ARGS%
set EXITCODE=%ERRORLEVEL%
rmdir /s /q "%WORK%" >nul 2>&1
if "%INTERACTIVE%"=="1" (
  if "%EXITCODE%"=="0" (
    echo.
    echo CourseForge installed successfully.
    echo Shortcuts have been created on your Desktop and Start Menu.
    echo.
    echo Press any key to close...
    pause >nul
  ) else (
    echo.
    echo Installation failed. Check logs in %%LOCALAPPDATA%%\CourseForge\logs for details.
    echo.
    echo Press any key to close...
    pause >nul
  )
)
endlocal & exit /b %EXITCODE%
"@
Set-Content -Path (Join-Path $bootstrapDir $bootstrapLauncherName) -Value $bootstrapLauncher -Encoding ASCII

$iexpressSed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=<None>
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles

[SourceFiles]
SourceFiles0=$bootstrapDir

[SourceFiles0]
%FILE0%=
%FILE1%=

[Strings]
TargetName=$installerExePath
FriendlyName=CourseForge Setup
AppLaunched=cmd.exe /k $bootstrapLauncherName
AdminQuietInstCmd=cmd.exe /c $bootstrapLauncherName -Silent -InstallBoth
UserQuietInstCmd=cmd.exe /c $bootstrapLauncherName -Silent -InstallBoth
FILE0=$bootstrapZipName
FILE1=$bootstrapLauncherName
"@
Set-Content -Path $iexpressSedPath -Value $iexpressSed -Encoding ASCII

& iexpress.exe /N $iexpressSedPath | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "IExpress failed to create the Windows installer executable (exit code $LASTEXITCODE)."
}

Remove-Item $bootstrapDir -Recurse -Force
Remove-Item $iexpressSedPath -Force

Write-Host "[package] Windows package created: $zipPath"
Write-Host "[package] Windows installer created: $installerExePath"
Write-Host "[package] Installer file: $packageDir\Install-CourseForge-Windows.cmd"
