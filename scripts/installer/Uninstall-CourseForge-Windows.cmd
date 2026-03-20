@echo off
REM Uninstall-CourseForge-Windows.cmd
REM Entry point for uninstalling CourseForge
REM Can be called directly (GUI mode) or with /SILENT for CLI mode

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set PS_SCRIPT=%SCRIPT_DIR%Install-CourseForge-Windows.ps1

if not exist "%PS_SCRIPT%" (
  echo Error: PowerShell installer script not found
  pause
  exit /b 1
)

REM If /SILENT flag is present, run silent uninstall
if /i "%~1"=="/SILENT" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -Silent -Uninstall
) else (
  REM Otherwise, show GUI uninstaller
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -Uninstall
)
