@echo off
setlocal
set ROOT=%~dp0
if exist "%ROOT%AutoUpdate-CourseForge.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%AutoUpdate-CourseForge.ps1" -CurrentVersion "1.2.1" -Owner "ronaldarroyowatson" -Repo "CourseForge" >nul 2>&1
)
set APP=%ROOT%webapp\index.html
if not exist "%APP%" (
  echo [CourseForge] Missing webapp\index.html in package.
  exit /b 1
)
start "CourseForge" "%APP%"
