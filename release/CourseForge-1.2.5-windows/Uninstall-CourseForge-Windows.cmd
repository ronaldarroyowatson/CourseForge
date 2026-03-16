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
