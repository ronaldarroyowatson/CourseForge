param(
  [string]$InstallPath = "$env:LOCALAPPDATA\CourseForge",
  [switch]$CreateDesktopShortcut
)

$ErrorActionPreference = "Stop"

$sourceRoot = Split-Path -Parent $PSCommandPath
$resolvedInstall = [System.IO.Path]::GetFullPath($InstallPath)

if (-not (Test-Path $resolvedInstall)) {
  New-Item -Path $resolvedInstall -ItemType Directory -Force | Out-Null
}

$null = robocopy $sourceRoot $resolvedInstall /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XF updater.log Install-CourseForge-Windows.ps1 Install-CourseForge-Windows.cmd
if ($LASTEXITCODE -gt 7) {
  throw "Installer copy failed with robocopy exit code $LASTEXITCODE"
}

if ($CreateDesktopShortcut) {
  $desktopPath = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktopPath "CourseForge.lnk"
  $targetPath = Join-Path $resolvedInstall "Start-CourseForge.cmd"

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.WorkingDirectory = $resolvedInstall
  $shortcut.IconLocation = "C:\WINDOWS\System32\SHELL32.dll,220"
  $shortcut.Save()
}

Write-Host "CourseForge installed to $resolvedInstall"
Write-Host "Run Start-CourseForge.cmd to launch."
