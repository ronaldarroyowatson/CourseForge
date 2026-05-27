@echo off
setlocal enabledelayedexpansion

REM Launch-CourseForge-Uninstaller-GUI.cmd
REM GUI Uninstaller for CourseForge called from Windows Settings/Add Remove Programs

set SCRIPT_DIR=%~dp0

REM Execute the GUI uninstaller PowerShell script
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Launch-CourseForge-Uninstaller-GUI.ps1" %*
exit /b %ERRORLEVEL%
