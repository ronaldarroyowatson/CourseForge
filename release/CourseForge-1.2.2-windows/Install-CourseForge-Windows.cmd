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
