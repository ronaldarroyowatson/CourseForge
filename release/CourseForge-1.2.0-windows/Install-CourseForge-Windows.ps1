param(
  [string]$InstallPath,
  [switch]$NoDesktopIcon,
  [switch]$NoStartMenuIcon,
  [switch]$Silent,
  [switch]$FullAuto
)

$ErrorActionPreference = "Stop"

if ($FullAuto) {
  $Silent = $true
}

$sourceRoot = Split-Path -Parent $PSCommandPath
$defaultInstallPath = Join-Path $env:LOCALAPPDATA "CourseForge"
$installPathSource = "default"

if ([string]::IsNullOrWhiteSpace($InstallPath)) {
  $InstallPath = $defaultInstallPath
}
elseif ([System.StringComparer]::OrdinalIgnoreCase.Equals($InstallPath, $defaultInstallPath)) {
  $installPathSource = "default"
}
else {
  $installPathSource = "cli-argument"
}

function Confirm-InstallLocationFlow {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $message = "Default install location:`n`n$defaultInstallPath`n`nSelect Yes to choose a custom folder, No to use the default location, or Cancel to exit setup."
    $result = [System.Windows.Forms.MessageBox]::Show(
      $message,
      "CourseForge Setup - Install Location",
      [System.Windows.Forms.MessageBoxButtons]::YesNoCancel,
      [System.Windows.Forms.MessageBoxIcon]::Question
    )

    return $result
  }
  catch {
    Write-Warning "Could not open install-location prompt. Falling back to standard flow."
    return "No"
  }
}

function Select-InstallPathFromDialog {
  param([string]$InitialPath)

  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Choose where to install CourseForge"
    $dialog.ShowNewFolderButton = $true
    if (-not [string]::IsNullOrWhiteSpace($InitialPath)) {
      $dialog.SelectedPath = $InitialPath
    }

    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) {
      return $dialog.SelectedPath
    }
  }
  catch {
    Write-Warning "Could not open install-location dialog. Falling back to default path."
  }

  return $null
}

if (-not $Silent) {
  $locationChoice = Confirm-InstallLocationFlow
  if ($locationChoice -eq [System.Windows.Forms.DialogResult]::Cancel) {
    Write-Host "Installation cancelled by user."
    exit 3
  }

  if ($locationChoice -eq [System.Windows.Forms.DialogResult]::Yes) {
    $selectedPath = Select-InstallPathFromDialog -InitialPath $InstallPath
    if (-not [string]::IsNullOrWhiteSpace($selectedPath)) {
      $InstallPath = $selectedPath
      $installPathSource = "user-selected"
    }
    else {
      Write-Host "No folder selected. Continuing with current install path."
    }
  }
  elseif ($installPathSource -eq "default") {
    $InstallPath = $defaultInstallPath
  }
}

$resolvedInstall = [System.IO.Path]::GetFullPath($InstallPath)
$logDirectory = Join-Path $env:LOCALAPPDATA "CourseForge"
$logPath = Join-Path $logDirectory "installer.log"

if (-not (Test-Path $logDirectory)) {
  New-Item -Path $logDirectory -ItemType Directory -Force | Out-Null
}

function Write-InstallerLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logPath -Value "[$timestamp] $Message" -Encoding ASCII
}

Write-InstallerLog "Starting installation to $resolvedInstall"

if (-not (Test-Path $resolvedInstall)) {
  New-Item -Path $resolvedInstall -ItemType Directory -Force | Out-Null
}

$null = robocopy $sourceRoot $resolvedInstall /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XF updater.log installer.log silent-install.log auto-install.log repair.log uninstaller.log Install-CourseForge-Windows.ps1 Install-CourseForge-Windows.cmd
if ($LASTEXITCODE -gt 7) {
  Write-InstallerLog "Robocopy failed with exit code $LASTEXITCODE"
  throw "Installer copy failed with robocopy exit code $LASTEXITCODE"
}

$shell = New-Object -ComObject WScript.Shell

if (-not $NoDesktopIcon) {
  $desktopPath = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktopPath "CourseForge.lnk"
  $targetPath = Join-Path $resolvedInstall "Start-CourseForge.cmd"

  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.WorkingDirectory = $resolvedInstall
  $shortcut.IconLocation = "C:\WINDOWS\System32\SHELL32.dll,220"
  $shortcut.Save()

  Write-InstallerLog "Created desktop shortcut: $shortcutPath"
}

if (-not $NoStartMenuIcon) {
  $programsPath = [Environment]::GetFolderPath("Programs")
  $startMenuDir = Join-Path $programsPath "CourseForge"
  if (-not (Test-Path $startMenuDir)) {
    New-Item -Path $startMenuDir -ItemType Directory -Force | Out-Null
  }

  $startMenuShortcutPath = Join-Path $startMenuDir "CourseForge.lnk"
  $targetPath = Join-Path $resolvedInstall "Start-CourseForge.cmd"

  $startMenuShortcut = $shell.CreateShortcut($startMenuShortcutPath)
  $startMenuShortcut.TargetPath = $targetPath
  $startMenuShortcut.WorkingDirectory = $resolvedInstall
  $startMenuShortcut.IconLocation = "C:\WINDOWS\System32\SHELL32.dll,220"
  $startMenuShortcut.Save()

  Write-InstallerLog "Created start menu shortcut: $startMenuShortcutPath"
}

$metadataPath = Join-Path $resolvedInstall "installer-metadata.json"
$metadata = [ordered]@{
  productName = "CourseForge"
  installPath = $resolvedInstall
  installPathSource = $installPathSource
  iconOptions = [ordered]@{
    desktop = -not $NoDesktopIcon
    startMenu = -not $NoStartMenuIcon
  }
  mode = if ($FullAuto) { "fullauto" } elseif ($Silent) { "silent" } else { "interactive" }
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
}
$metadata | ConvertTo-Json -Depth 5 | Set-Content -Path $metadataPath -Encoding ASCII
Write-InstallerLog "Wrote installer metadata: $metadataPath"

Write-InstallerLog "Installation completed successfully"

Write-Host "CourseForge installed to $resolvedInstall"
Write-Host "Run Start-CourseForge.cmd to launch."
