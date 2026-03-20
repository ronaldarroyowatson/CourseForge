@echo off
REM Start-CourseForge.cmd - Start the CourseForge application locally
REM This script uses PowerShell to start an HTTP server and open it in the default browser

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"

set "LAUNCH_CMD=powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%SCRIPT_DIR%Start-CourseForge.ps1\""

REM Run the launcher hidden to avoid a visible console window during startup.
start "" /B cmd /c %LAUNCH_CMD%
set "ERRORCODE=%ERRORLEVEL%"

if not "%ERRORCODE%"=="0" (
  echo.
  echo [CourseForge] Launcher failed to start hidden process (error %ERRORCODE%).
  echo [CourseForge] Falling back to visible launcher for diagnostics.
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Start-CourseForge.ps1"
  set "ERRORCODE=%ERRORLEVEL%"
)

REM If there was an error, pause so the user can see the error message
if not "%ERRORCODE%"=="0" (
  echo.
  echo [CourseForge] Launcher exited with error code %ERRORCODE%
  echo [CourseForge] Check %%LOCALAPPDATA%%\CourseForge\logs\launcher.log for details.
  echo [CourseForge] Or if in temp directory: %%TEMP%%\CourseForge-launcher\launcher.log
  echo.
  pause
)

exit /b %ERRORCODE%
