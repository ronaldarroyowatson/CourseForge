@echo off
REM Start-CourseForge.cmd - Start the CourseForge application locally
REM This script uses PowerShell to start an HTTP server and open it in the default browser

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"

REM Call PowerShell to do the heavy lifting
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Start-CourseForge.ps1"

exit /b %ERRORLEVEL%
