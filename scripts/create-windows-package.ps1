param(
  [string]$Version,
  [switch]$RequireGuiInstaller,
  [switch]$EmitWindowsZip,
  [switch]$AllowLegacyBootstrap
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$packageJsonPath = Join-Path $repoRoot "package.json"
$packageJson = Get-Content -Path $packageJsonPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = $packageJson.version
}

$requireGuiFromEnv = $false
if (-not [string]::IsNullOrWhiteSpace($env:COURSEFORGE_REQUIRE_GUI_INSTALLER)) {
  $normalizedGuiFlag = $env:COURSEFORGE_REQUIRE_GUI_INSTALLER.Trim().ToLowerInvariant()
  if ($normalizedGuiFlag -in @("1", "true", "yes", "on")) {
    $requireGuiFromEnv = $true
  }
}

$requireGuiInstaller = $RequireGuiInstaller.IsPresent -or $requireGuiFromEnv

$emitZipFromEnv = $false
if (-not [string]::IsNullOrWhiteSpace($env:COURSEFORGE_EMIT_WINDOWS_ZIP)) {
  $normalizedZipFlag = $env:COURSEFORGE_EMIT_WINDOWS_ZIP.Trim().ToLowerInvariant()
  if ($normalizedZipFlag -in @("1", "true", "yes", "on")) {
    $emitZipFromEnv = $true
  }
}

$releaseRoot = Join-Path $repoRoot "release"
$portableName = "CourseForge-$Version-portable"
$portableDir = Join-Path $releaseRoot $portableName

Write-Host "[package] Refreshing portable package..."
& (Join-Path $PSScriptRoot "create-portable-package.ps1") -Version $Version

$packageName = "CourseForge-$Version-windows"
$packageDir = Join-Path $releaseRoot $packageName
$zipPath = Join-Path $releaseRoot "$packageName.zip"
$installerExePath = Join-Path $releaseRoot "CourseForge-$Version-installer.exe"
$bootstrapDir = Join-Path $releaseRoot ".windows-installer-bootstrap-$Version"
$bootstrapZipName = "CourseForge-windows-payload.zip"
$bootstrapLauncherName = "Launch-CourseForge-Installer.cmd"
$iexpressSedPath = Join-Path $releaseRoot ".windows-installer-$Version.sed"
$innoTemplatePath = Join-Path $repoRoot "scripts/installer/windows-installer.iss.template"
$innoScriptPath = Join-Path $releaseRoot ".windows-installer-$Version.iss"

function Get-InnoSetupCompilerPath {
  $candidate = Get-Command iscc.exe -ErrorAction SilentlyContinue
  if ($null -ne $candidate) {
    return $candidate.Source
  }

  foreach ($path in @(
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  )) {
    if (Test-Path $path) {
      return $path
    }
  }

  return $null
}

function New-WindowsZipArtifact {
  param(
    [string]$SourcePackageDir,
    [string]$DestinationZipPath
  )

  $zipSucceeded = $false
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Compress-Archive -Path (Join-Path $SourcePackageDir "*") -DestinationPath $DestinationZipPath -CompressionLevel Optimal
      $zipSucceeded = $true
      break
    }
    catch {
      if ($attempt -ge 3) {
        throw
      }

      Start-Sleep -Seconds 1
      if (Test-Path $DestinationZipPath) {
        Remove-Item $DestinationZipPath -Force -ErrorAction SilentlyContinue
      }
    }
  }

  if (-not $zipSucceeded) {
    throw "Failed to create Windows package zip: $DestinationZipPath"
  }
}

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
if (Test-Path $innoScriptPath) {
  Remove-Item $innoScriptPath -Force
}

Copy-Item -Path $portableDir -Destination $packageDir -Recurse -Force

# Copy GUI uninstaller files from scripts/installer directory
$guiUninstallerFiles = @(
  "Launch-CourseForge-Uninstaller.cmd",
  "Launch-CourseForge-Uninstaller-GUI.ps1",
  "Launch-CourseForge-Uninstaller-GUI.cmd"
)
foreach ($file in $guiUninstallerFiles) {
  $sourcePath = Join-Path (Join-Path (Join-Path $repoRoot "scripts") "installer") $file
  if (Test-Path $sourcePath) {
    Copy-Item -Path $sourcePath -Destination (Join-Path $packageDir $file) -Force
  } else {
    Write-Warning "GUI uninstaller file not found: $sourcePath"
  }
}

$startCmdTemplatePath = Join-Path (Join-Path (Join-Path $repoRoot "scripts") "installer") "Start-CourseForge.cmd"
if (Test-Path $startCmdTemplatePath) {
  Copy-Item -Path $startCmdTemplatePath -Destination (Join-Path $packageDir "Start-CourseForge.cmd") -Force
}
else {
  Write-Warning "Start launcher template not found: $startCmdTemplatePath. Falling back to minimal launcher wrapper."
  $startCmdFallback = @"
@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Start-CourseForge.ps1"
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
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%AutoUpdate-CourseForge.ps1" -CurrentVersion "$Version" -AssetNameTemplate "CourseForge-{version}-portable.zip" -CheckOnly
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
for %%I in ("%ROOT%.") do set INSTALLROOT=%%~fI
pushd "%TEMP%" >nul 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%Install-CourseForge-Windows.ps1" -InstallPath "%INSTALLROOT%" -Uninstall %*
set EXITCODE=%ERRORLEVEL%
popd >nul 2>&1
if not "%EXITCODE%"=="0" (
  echo [CourseForge] Uninstall failed with code %EXITCODE%.
  exit /b %EXITCODE%
)
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2; Remove-Item -LiteralPath '%INSTALLROOT%' -Recurse -Force -ErrorAction SilentlyContinue"
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
$manifest.updates.assetTemplate = "CourseForge-{version}-portable.zip"
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

$innoCompilerPath = Get-InnoSetupCompilerPath
$emitZipArtifact = $EmitWindowsZip.IsPresent -or $emitZipFromEnv
if (-not $emitZipArtifact -and [string]::IsNullOrWhiteSpace($innoCompilerPath)) {
  # Legacy bootstrap mode still needs a payload zip.
  $emitZipArtifact = $true
}

if ($emitZipArtifact) {
  New-WindowsZipArtifact -SourcePackageDir $packageDir -DestinationZipPath $zipPath
} elseif (Test-Path $zipPath) {
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
}

function Escape-InnoLiteral {
  param([string]$Value)

  if ($null -eq $Value) {
    return ""
  }

  return $Value.Replace('"', '""')
}

if ([string]::IsNullOrWhiteSpace($innoCompilerPath)) {
  if (-not (Test-Path $zipPath)) {
    New-WindowsZipArtifact -SourcePackageDir $packageDir -DestinationZipPath $zipPath
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
set LOGDIR=%LOCALAPPDATA%\CourseForge\logs
set LOGFILE=%LOGDIR%\installer-bootstrap.log
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1
set INTERACTIVE=1
for %%A in (%*) do (
  if /I "%%~A"=="-FullAuto" set INTERACTIVE=0
  if /I "%%~A"=="-Silent" set INTERACTIVE=0
  if /I "%%~A"=="-Uninstall" set INTERACTIVE=0
)
echo [%%DATE%% %%TIME%%] Bootstrap start. Args: %* >> "%LOGFILE%"
if exist "%WORK%" rmdir /s /q "%WORK%" >nul 2>&1
mkdir "%EXTRACT%" >nul 2>&1
if not exist "%PAYLOAD%" (
  echo [CourseForge] Missing installer payload archive.
  echo [%%DATE%% %%TIME%%] Missing payload archive: %PAYLOAD% >> "%LOGFILE%"
  if "%INTERACTIVE%"=="1" pause
  endlocal
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%PAYLOAD%' -DestinationPath '%EXTRACT%' -Force" >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [CourseForge] Failed to extract installer payload.
  echo [%%DATE%% %%TIME%%] Expand-Archive failed. >> "%LOGFILE%"
  rmdir /s /q "%WORK%" >nul 2>&1
  if "%INTERACTIVE%"=="1" pause
  endlocal
  exit /b 1
)
if not exist "%INSTALLER%" (
  echo [CourseForge] Missing extracted installer script.
  echo [%%DATE%% %%TIME%%] Missing installer script after extraction: %INSTALLER% >> "%LOGFILE%"
  rmdir /s /q "%WORK%" >nul 2>&1
  if "%INTERACTIVE%"=="1" pause
  endlocal
  exit /b 1
)
set INSTALL_ARGS=%*
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" %INSTALL_ARGS%
set EXITCODE=%ERRORLEVEL%
echo [%%DATE%% %%TIME%%] Installer exit code: %EXITCODE% >> "%LOGFILE%"
rmdir /s /q "%WORK%" >nul 2>&1
if "%EXITCODE%"=="0" (
  echo [%%DATE%% %%TIME%%] Installation succeeded. Exiting silently. >> "%LOGFILE%"
) else (
  echo [%%DATE%% %%TIME%%] Installation failed with exit code %EXITCODE%. >> "%LOGFILE%"
  if "%INTERACTIVE%"=="1" (
    echo.
    echo Installation failed. Check logs in %%LOCALAPPDATA%%\CourseForge\logs for details.
    echo Bootstrap log: %LOGFILE%
    echo.
    echo Press any key to close...
    pause >nul
  )
)
endlocal & exit /b %EXITCODE%
"@
  Set-Content -Path (Join-Path $bootstrapDir $bootstrapLauncherName) -Value $bootstrapLauncher -Encoding ASCII

  Copy-Item -Path (Join-Path $packageDir "CourseForge.ico") -Destination (Join-Path $bootstrapDir "CourseForge.ico") -Force
}

if (-not [string]::IsNullOrWhiteSpace($innoCompilerPath)) {
  if (-not (Test-Path $innoTemplatePath)) {
    throw "Inno Setup template not found: $innoTemplatePath"
  }

  $innoScript = Get-Content -Path $innoTemplatePath -Raw
  $innoScript = $innoScript.Replace("__COURSEFORGE_VERSION__", (Escape-InnoLiteral -Value $Version))
  $innoScript = $innoScript.Replace("__COURSEFORGE_PACKAGE_DIR__", (Escape-InnoLiteral -Value $packageDir))
  $innoScript = $innoScript.Replace("__COURSEFORGE_RELEASE_ROOT__", (Escape-InnoLiteral -Value $releaseRoot))
  Set-Content -Path $innoScriptPath -Value $innoScript -Encoding ASCII

  & $innoCompilerPath /Qp $innoScriptPath | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup failed to create the Windows installer executable (exit code $LASTEXITCODE)."
  }

  if (Test-Path $bootstrapDir) {
    Remove-Item $bootstrapDir -Recurse -Force
  }
  Remove-Item $innoScriptPath -Force

  if (Test-Path $zipPath) {
    Write-Host "[package] Windows package created: $zipPath"
  } else {
    Write-Host "[package] Windows package zip skipped (GUI installer mode default)."
  }
  Write-Host "[package] Windows installer created (GUI): $installerExePath"
  Write-Host "[package] Installer file: $packageDir\Install-CourseForge-Windows.cmd"
  return
}

if ($requireGuiInstaller) {
  throw "GUI installer is required but Inno Setup compiler (ISCC.exe) was not found. Install Inno Setup 6 or unset -RequireGuiInstaller / COURSEFORGE_REQUIRE_GUI_INSTALLER."
}

if (-not $AllowLegacyBootstrap.IsPresent) {
  throw "Inno Setup compiler (ISCC.exe) was not found and legacy bootstrap fallback is disabled by default to avoid AV-sensitive ZIP bootstrap behavior. Install Inno Setup 6, or rerun with -AllowLegacyBootstrap if you explicitly need the legacy path."
}

Write-Warning "Inno Setup compiler (ISCC.exe) not found. Falling back to legacy bootstrap installer."
Write-Warning "Install Inno Setup 6 to produce a standard Windows wizard UI installer on double-click."

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
AppLaunched=cmd.exe /c "%FILE1%"
AdminQuietInstCmd=cmd.exe /c "%FILE1%" -FullAuto
UserQuietInstCmd=cmd.exe /c "%FILE1%" -FullAuto
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
Write-Host "[package] Windows installer created (legacy bootstrap): $installerExePath"
Write-Host "[package] Installer file: $packageDir\Install-CourseForge-Windows.cmd"
