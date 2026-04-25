#!/usr/bin/env powershell
<#
.SYNOPSIS
CourseForge Uninstaller GUI
.DESCRIPTION
Interactive uninstaller with GUI dialogs for better user experience
#>

param(
  [string]$InstallPath
)

$ErrorActionPreference = "SilentlyContinue"

# Detect install path from Registry if not provided
if ([string]::IsNullOrWhiteSpace($InstallPath)) {
  try {
    $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CourseForge"
    if (Test-Path $regPath) {
      $InstallPath = (Get-ItemProperty -Path $regPath).InstallLocation
    }
  }
  catch {}
}

if ([string]::IsNullOrWhiteSpace($InstallPath)) {
  try {
    $regPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CourseForge"
    if (Test-Path $regPath) {
      $InstallPath = (Get-ItemProperty -Path $regPath).InstallLocation
    }
  }
  catch {}
}

# Load WinForms
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Uninstall CourseForge"
$form.AutoSize = $false
$form.Width = 620
$form.Height = 420
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Icon = $null

# Title label
$labelTitle = New-Object System.Windows.Forms.Label
$labelTitle.Text = "CourseForge Uninstaller"
$labelTitle.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$labelTitle.AutoSize = $false
$labelTitle.Width = 580
$labelTitle.Height = 40
$labelTitle.Location = New-Object System.Drawing.Point(20, 16)
$form.Controls.Add($labelTitle)

# Info text
$labelInfo = New-Object System.Windows.Forms.Label
$labelInfo.Text = "Are you sure you want to uninstall CourseForge?`n`nInstall Location:`n$InstallPath"
$labelInfo.AutoSize = $false
$labelInfo.Width = 580
$labelInfo.Height = 120
$labelInfo.Location = New-Object System.Drawing.Point(20, 64)
$form.Controls.Add($labelInfo)

# Checkbox for deleting user data
$checkboxData = New-Object System.Windows.Forms.CheckBox
$checkboxData.Text = "Also delete stored textbooks and app data"
$checkboxData.AutoSize = $true
$checkboxData.Location = New-Object System.Drawing.Point(28, 196)
$form.Controls.Add($checkboxData)

# Small help text so users understand this is the only choice required.
$labelHelp = New-Object System.Windows.Forms.Label
$labelHelp.Text = "Everything else will be removed automatically."
$labelHelp.AutoSize = $false
$labelHelp.Width = 560
$labelHelp.Height = 22
$labelHelp.Location = New-Object System.Drawing.Point(28, 226)
$form.Controls.Add($labelHelp)

# Uninstall button
$buttonUninstall = New-Object System.Windows.Forms.Button
$buttonUninstall.Text = "Uninstall"
$buttonUninstall.Width = 140
$buttonUninstall.Height = 40
$buttonUninstall.Location = New-Object System.Drawing.Point(300, 300)
$buttonUninstall.BackColor = [System.Drawing.Color]::FromArgb(200, 50, 50)
$buttonUninstall.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($buttonUninstall)

# Cancel button
$buttonCancel = New-Object System.Windows.Forms.Button
$buttonCancel.Text = "Cancel"
$buttonCancel.Width = 140
$buttonCancel.Height = 40
$buttonCancel.Location = New-Object System.Drawing.Point(450, 300)
$form.Controls.Add($buttonCancel)

# Button click handlers
$buttonCancel.Add_Click({
  $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $form.Close()
})

$buttonUninstall.Add_Click({
  $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Close()
})

# Show form and get result
$result = $form.ShowDialog()

# If user clicked Cancel, exit
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  exit 0
}

# Build uninstall command
$uninstallArgs = @("-Silent", "-Uninstall", "-InstallPath", $InstallPath)
if ($checkboxData.Checked) {
  $uninstallArgs += "-RemoveUserData"
}

# Find the installer PS1 script
$installerScript = Join-Path $InstallPath "Install-CourseForge-Windows.ps1"
if (-not (Test-Path $installerScript)) {
  [System.Windows.Forms.MessageBox]::Show(
    "Installer script not found at $installerScript",
    "Error",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  )
  exit 1
}

# Show progress dialog
$progressForm = New-Object System.Windows.Forms.Form
$progressForm.Text = "Uninstalling CourseForge"
$progressForm.AutoSize = $false
$progressForm.Width = 460
$progressForm.Height = 190
$progressForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$progressForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$progressForm.MaximizeBox = $false
$progressForm.MinimizeBox = $false
$progressForm.ControlBox = $false

$progressLabel = New-Object System.Windows.Forms.Label
$progressLabel.Text = "Uninstalling CourseForge. This may take a moment..."
$progressLabel.AutoSize = $false
$progressLabel.Width = 430
$progressLabel.Height = 60
$progressLabel.Location = New-Object System.Drawing.Point(15, 22)
$progressForm.Controls.Add($progressLabel)

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Marquee
$progressBar.AutoSize = $false
$progressBar.Width = 430
$progressBar.Height = 30
$progressBar.Location = New-Object System.Drawing.Point(15, 96)
$progressForm.Controls.Add($progressBar)

$progressForm.Show()
$progressForm.Refresh()

# Run uninstall
try {
  $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerScript @uninstallArgs 2>&1
  $exitCode = $LASTEXITCODE
  
  $progressForm.Close()
  
  if ($exitCode -eq 0) {
    [System.Windows.Forms.MessageBox]::Show(
      "CourseForge has been successfully uninstalled.",
      "Uninstall Complete",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    )
  } else {
    [System.Windows.Forms.MessageBox]::Show(
      "Uninstall completed with warnings or errors:`n`n$output",
      "Uninstall Complete with Issues",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    )
  }
  exit $exitCode
}
catch {
  $progressForm.Close()
  [System.Windows.Forms.MessageBox]::Show(
    "Uninstall failed: $($_.Exception.Message)",
    "Error",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  )
  exit 1
}
