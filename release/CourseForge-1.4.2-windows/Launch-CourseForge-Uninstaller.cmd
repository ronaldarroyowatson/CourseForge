@echo off
REM Launch-CourseForge-Uninstaller.cmd
REM This script is called by the Inno Setup uninstaller to execute the PowerShell installer module with uninstall parameters

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0

REM Extract the InstallPath from arguments
setlocal enabledelayedexpansion
for %%A in (%*) do (
  if "%%A"=="-InstallPath" (
    set "NEXT_IS_PATH=1"
  ) else if "!NEXT_IS_PATH!"=="1" (
    set "INSTALL_PATH=%%A"
    set "NEXT_IS_PATH=0"
  )
)

if not defined INSTALL_PATH (
  echo Error: InstallPath not provided
  pause
  exit /b 1
)

REM Find the PowerShell installer script
if exist "%INSTALL_PATH%\Install-CourseForge-Windows.ps1" (
  set "PS_SCRIPT=%INSTALL_PATH%\Install-CourseForge-Windows.ps1"
) else (
  echo Error: PowerShell installer script not found at %INSTALL_PATH%
  pause
  exit /b 1
)

REM Execute the uninstaller PowerShell script
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "!PS_SCRIPT!" %* -Uninstall
