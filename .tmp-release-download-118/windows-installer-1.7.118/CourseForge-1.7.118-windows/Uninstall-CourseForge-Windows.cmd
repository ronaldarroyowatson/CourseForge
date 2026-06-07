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
