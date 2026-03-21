@echo off
REM Start-CourseForge.cmd - Start the CourseForge application locally
REM This script uses PowerShell to start an HTTP server and open it in the default browser

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"

REM Default to headless background startup unless explicitly overridden.
if not defined COURSEFORGE_DISABLE_AUTO_BROWSER set "COURSEFORGE_DISABLE_AUTO_BROWSER=1"
if not defined COURSEFORGE_DETACH_AFTER_READY set "COURSEFORGE_DETACH_AFTER_READY=1"

REM Start detached (without /B) so closing this cmd window does not kill the launcher process tree.
start "" cmd /c powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_DIR%Start-CourseForge.ps1"
set "ERRORCODE=%ERRORLEVEL%"

if not "%ERRORCODE%"=="0" (
  echo.
  echo [CourseForge] Launcher failed to start hidden process ^(error %ERRORCODE%^).
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
