param(
  [string]$InstallPath,
  [switch]$Silent,
  [switch]$FullAuto,
  [switch]$InstallWebapp,
  [switch]$InstallExtension,
  [switch]$InstallBoth,
  [switch]$NoDesktopIcon,
  [switch]$NoStartMenuIcon,
  [switch]$Repair,
  [switch]$Uninstall,
  [switch]$Modify,
  [switch]$RemoveUserData
)

$ErrorActionPreference = "Stop"

$script:ProductName = "CourseForge"
$script:ProductVersion = "__COURSEFORGE_VERSION__"
$script:RegistryPath = "HKLM:\Software\CourseForge"
$script:UserRoot = Join-Path $env:LOCALAPPDATA "CourseForge"
$script:LogsRoot = Join-Path $script:UserRoot "logs"
$script:DataRoot = Join-Path $script:UserRoot "data"
$script:RollbackRoot = Join-Path $script:UserRoot "rollback"
$script:DefaultInstallPath = Join-Path $env:ProgramFiles "CourseForge"
$script:InstallerMetadataFileName = "installer-metadata.json"
$script:IntegrityManifestFileName = "installer-integrity.json"
$script:RollingSnapshotFileName = "installer-rollback-snapshot.json"
$script:CurrentLogPath = $null
$script:CurrentModeForLog = "install"

function Ensure-Directory {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
  }
}

function Get-TimestampString {
  return (Get-Date).ToUniversalTime().ToString("o")
}

function Initialize-Log {
  param([string]$Mode)

  Ensure-Directory -Path $script:LogsRoot

  $logFileName = switch ($Mode) {
    "repair" { "repair.log" }
    "uninstall" { "uninstaller.log" }
    "rollback" { "rollback.log" }
    "silent" { "silent-install.log" }
    "fullauto" { "auto-install.log" }
    default { "installer.log" }
  }

  $script:CurrentLogPath = Join-Path $script:LogsRoot $logFileName
  $script:CurrentModeForLog = $Mode

  if (-not (Test-Path $script:CurrentLogPath)) {
    New-Item -Path $script:CurrentLogPath -ItemType File -Force | Out-Null
  }
}

function Write-InstallerLog {
  param([string]$Message)

  if ([string]::IsNullOrWhiteSpace($script:CurrentLogPath)) {
    Initialize-Log -Mode "install"
  }

  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $script:CurrentLogPath -Value $line -Encoding ASCII
}

function Show-CompletionDialog {
  param(
    [bool]$Success,
    [string]$Body
  )

  if (-not $FullAuto) {
    return
  }

  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $caption = if ($Success) { "CourseForge Installer" } else { "CourseForge Installer - Failed" }
    $icon = if ($Success) { [System.Windows.Forms.MessageBoxIcon]::Information } else { [System.Windows.Forms.MessageBoxIcon]::Error }
    [System.Windows.Forms.MessageBox]::Show($Body, $caption, [System.Windows.Forms.MessageBoxButtons]::OK, $icon) | Out-Null
  }
  catch {
    if ($Success) {
      Write-Host $Body
    }
    else {
      Write-Error $Body
    }
  }
}

function Normalize-LegacyInstallerSwitches {
  foreach ($arg in $args) {
    switch ($arg.ToUpperInvariant()) {
      "/SILENT" { $script:Silent = $true; continue }
      "/FULLAUTO" { $script:FullAuto = $true; $script:Silent = $true; continue }
      "/INSTALL_WEBAPP" { $script:InstallWebapp = $true; continue }
      "/INSTALL_EXTENSION" { $script:InstallExtension = $true; continue }
      "/INSTALL_BOTH" { $script:InstallBoth = $true; continue }
      "/NO_DESKTOP_ICON" { $script:NoDesktopIcon = $true; continue }
      "/NO_STARTMENU_ICON" { $script:NoStartMenuIcon = $true; continue }
      "/REPAIR" { $script:Repair = $true; continue }
      "/UNINSTALL" { $script:Uninstall = $true; continue }
      "/MODIFY" { $script:Modify = $true; continue }
      "/REMOVE_USER_DATA" { $script:RemoveUserData = $true; continue }
    }
  }
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Read-RegistryState {
  if (-not (Test-Path $script:RegistryPath)) {
    return $null
  }

  try {
    $props = Get-ItemProperty -Path $script:RegistryPath
    return [ordered]@{
      InstallPath = [string]$props.InstallPath
      WebappInstalled = [bool][int]$props.WebappInstalled
      ExtensionInstalled = [bool][int]$props.ExtensionInstalled
      DesktopIconInstalled = [bool][int]$props.DesktopIconInstalled
      StartMenuIconInstalled = [bool][int]$props.StartMenuIconInstalled
      Version = [string]$props.Version
      LastRepairTimestamp = [string]$props.LastRepairTimestamp
      SilentInstallAllowed = [bool][int]$props.SilentInstallAllowed
    }
  }
  catch {
    Write-InstallerLog "Failed to read registry map: $($_.Exception.Message)"
    return $null
  }
}

function Write-RegistryState {
  param(
    [string]$InstallPath,
    [bool]$WebappInstalled,
    [bool]$ExtensionInstalled,
    [bool]$DesktopIconInstalled,
    [bool]$StartMenuIconInstalled,
    [string]$LastRepairTimestamp,
    [bool]$SilentInstallAllowed = $true
  )

  if (-not (Test-IsAdmin)) {
    throw "Administrator rights are required to write HKLM:\Software\CourseForge."
  }

  if (-not (Test-Path $script:RegistryPath)) {
    New-Item -Path $script:RegistryPath -Force | Out-Null
  }

  New-ItemProperty -Path $script:RegistryPath -Name "InstallPath" -Value $InstallPath -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $script:RegistryPath -Name "WebappInstalled" -Value ([int]$WebappInstalled) -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $script:RegistryPath -Name "ExtensionInstalled" -Value ([int]$ExtensionInstalled) -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $script:RegistryPath -Name "DesktopIconInstalled" -Value ([int]$DesktopIconInstalled) -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $script:RegistryPath -Name "StartMenuIconInstalled" -Value ([int]$StartMenuIconInstalled) -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $script:RegistryPath -Name "Version" -Value $script:ProductVersion -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $script:RegistryPath -Name "LastRepairTimestamp" -Value $LastRepairTimestamp -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $script:RegistryPath -Name "SilentInstallAllowed" -Value ([int]$SilentInstallAllowed) -PropertyType DWord -Force | Out-Null
}

function Remove-RegistryState {
  if (Test-Path $script:RegistryPath) {
    Remove-Item -Path $script:RegistryPath -Force
  }
}

function Get-StartMenuFolder {
  $programsPath = [Environment]::GetFolderPath("Programs")
  return Join-Path $programsPath "CourseForge"
}

function Get-DesktopShortcutPath {
  $desktopPath = [Environment]::GetFolderPath("Desktop")
  return Join-Path $desktopPath "CourseForge.lnk"
}

function Get-ShortcutState {
  $startMenuFolder = Get-StartMenuFolder
  return [ordered]@{
    desktop = Test-Path (Get-DesktopShortcutPath)
    startMenu = Test-Path (Join-Path $startMenuFolder "CourseForge Webapp.lnk")
  }
}

function New-Shortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$WorkingDirectory,
    [string]$IconLocation = "$env:SystemRoot\System32\SHELL32.dll,220"
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.IconLocation = $IconLocation
  $shortcut.Save()
}

function Set-Shortcuts {
  param(
    [string]$ResolvedInstallPath,
    [bool]$CreateDesktop,
    [bool]$CreateStartMenu
  )

  $desktopShortcut = Get-DesktopShortcutPath
  $startMenuFolder = Get-StartMenuFolder

  if ($CreateDesktop) {
    New-Shortcut -ShortcutPath $desktopShortcut -TargetPath (Join-Path $ResolvedInstallPath "Start-CourseForge.cmd") -WorkingDirectory $ResolvedInstallPath
    Write-InstallerLog "Created desktop shortcut: $desktopShortcut"
  }
  elseif (Test-Path $desktopShortcut) {
    Remove-Item $desktopShortcut -Force -ErrorAction SilentlyContinue
    Write-InstallerLog "Removed desktop shortcut by request."
  }

  if ($CreateStartMenu) {
    Ensure-Directory -Path $startMenuFolder
    New-Shortcut -ShortcutPath (Join-Path $startMenuFolder "CourseForge Webapp.lnk") -TargetPath (Join-Path $ResolvedInstallPath "Start-CourseForge.cmd") -WorkingDirectory $ResolvedInstallPath
    New-Shortcut -ShortcutPath (Join-Path $startMenuFolder "CourseForge Extension Folder.lnk") -TargetPath (Join-Path $ResolvedInstallPath "extension") -WorkingDirectory (Join-Path $ResolvedInstallPath "extension")
    New-Shortcut -ShortcutPath (Join-Path $startMenuFolder "Uninstall CourseForge.lnk") -TargetPath (Join-Path $ResolvedInstallPath "Uninstall-CourseForge-Windows.cmd") -WorkingDirectory $ResolvedInstallPath
    Write-InstallerLog "Created start menu shortcuts in: $startMenuFolder"
  }
  elseif (Test-Path $startMenuFolder) {
    Remove-Item $startMenuFolder -Recurse -Force -ErrorAction SilentlyContinue
    Write-InstallerLog "Removed start menu folder by request."
  }
}

function Remove-Shortcuts {
  $desktopShortcut = Get-DesktopShortcutPath
  $startMenuFolder = Get-StartMenuFolder

  if (Test-Path $desktopShortcut) {
    Remove-Item $desktopShortcut -Force -ErrorAction SilentlyContinue
  }

  if (Test-Path $startMenuFolder) {
    Remove-Item $startMenuFolder -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Get-InstallPathFromMetadata {
  param([string]$CandidatePath)

  if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
    return $null
  }

  $metadataPath = Join-Path $CandidatePath $script:InstallerMetadataFileName
  if (-not (Test-Path $metadataPath)) {
    return $null
  }

  try {
    $metadata = Get-Content -Path $metadataPath -Raw | ConvertFrom-Json
    return [string]$metadata.installPath
  }
  catch {
    return $null
  }
}

function Get-EffectiveInstallPath {
  param([string]$RequestedPath)

  if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
    return [System.IO.Path]::GetFullPath($RequestedPath)
  }

  $registry = Read-RegistryState
  if ($null -ne $registry -and -not [string]::IsNullOrWhiteSpace($registry.InstallPath)) {
    return [System.IO.Path]::GetFullPath($registry.InstallPath)
  }

  $metadataInstallPath = Get-InstallPathFromMetadata -CandidatePath $script:DefaultInstallPath
  if (-not [string]::IsNullOrWhiteSpace($metadataInstallPath)) {
    return [System.IO.Path]::GetFullPath($metadataInstallPath)
  }

  return [System.IO.Path]::GetFullPath($script:DefaultInstallPath)
}

function Detect-Installation {
  param([string]$ResolvedInstallPath)

  $metadataPath = Join-Path $ResolvedInstallPath $script:InstallerMetadataFileName
  $webappPath = Join-Path $ResolvedInstallPath "webapp"
  $extensionPath = Join-Path $ResolvedInstallPath "extension"

  $isInstalled = (Test-Path $metadataPath) -or (Test-Path $webappPath) -or (Test-Path $extensionPath)

  $metadata = $null
  if (Test-Path $metadataPath) {
    try {
      $metadata = Get-Content -Path $metadataPath -Raw | ConvertFrom-Json
    }
    catch {
      Write-InstallerLog "Metadata file exists but could not be parsed."
    }
  }

  return [ordered]@{
    isInstalled = $isInstalled
    metadata = $metadata
    metadataPath = $metadataPath
    webappInstalled = Test-Path $webappPath
    extensionInstalled = Test-Path $extensionPath
  }
}

function Read-YesNo {
  param(
    [string]$Prompt,
    [bool]$DefaultValue
  )

  if ($Silent -or $FullAuto) {
    return $DefaultValue
  }

  while ($true) {
    $defaultLabel = if ($DefaultValue) { "Y" } else { "N" }
    $response = Read-Host "$Prompt [Y/N] (default: $defaultLabel)"
    if ([string]::IsNullOrWhiteSpace($response)) {
      return $DefaultValue
    }

    switch ($response.Trim().ToUpperInvariant()) {
      "Y" { return $true }
      "YES" { return $true }
      "N" { return $false }
      "NO" { return $false }
      default {
        Write-Host "Please enter Y or N."
      }
    }
  }
}

function Show-InitialDetectionMenu {
  param([bool]$IsInstalled)

  if ($Silent -or $FullAuto) {
    return $null
  }

  if (-not $IsInstalled) {
    Write-Host "CourseForge is not currently installed."
    Write-Host "1) Install CourseForge"
    Write-Host "2) Full Auto Install"
    while ($true) {
      $choice = Read-Host "Choose action (1-2)"
      switch ($choice) {
        "1" { return "install" }
        "2" { return "fullauto" }
        default { Write-Host "Invalid selection." }
      }
    }
  }

  Write-Host "Existing CourseForge installation detected."
  Write-Host "1) Modify Installation"
  Write-Host "2) Repair Installation"
  Write-Host "3) Uninstall CourseForge"
  Write-Host "4) Exit"

  while ($true) {
    $choice = Read-Host "Choose action (1-4)"
    switch ($choice) {
      "1" { return "modify" }
      "2" { return "repair" }
      "3" { return "uninstall" }
      "4" { return "exit" }
      default { Write-Host "Invalid selection." }
    }
  }
}

function Resolve-ComponentSelection {
  param(
    [bool]$DefaultWebapp,
    [bool]$DefaultExtension,
    [string]$Mode
  )

  $webapp = $DefaultWebapp
  $extension = $DefaultExtension

  if ($InstallBoth) {
    $webapp = $true
    $extension = $true
  }
  elseif ($InstallWebapp -or $InstallExtension) {
    $webapp = [bool]$InstallWebapp
    $extension = [bool]$InstallExtension
  }
  elseif ($Silent -or $FullAuto) {
    $webapp = $DefaultWebapp
    $extension = $DefaultExtension
  }
  else {
    $webapp = Read-YesNo -Prompt "Install Webapp" -DefaultValue $DefaultWebapp
    $extension = Read-YesNo -Prompt "Install Browser Extension" -DefaultValue $DefaultExtension
  }

  if (-not $webapp -and -not $extension) {
    throw "At least one component must be selected before continuing."
  }

  Write-InstallerLog "Resolved component selection for $Mode: webapp=$webapp extension=$extension"

  return [ordered]@{ webapp = $webapp; extension = $extension }
}

function Resolve-IconSelection {
  $desktop = -not $NoDesktopIcon
  $startMenu = -not $NoStartMenuIcon

  if (-not $Silent -and -not $FullAuto) {
    $desktop = Read-YesNo -Prompt "Create Desktop Icon" -DefaultValue $desktop
    $startMenu = Read-YesNo -Prompt "Create Start Menu Icon" -DefaultValue $startMenu
  }

  return [ordered]@{ desktop = $desktop; startMenu = $startMenu }
}

function Get-IntegrityManifestPath {
  param([string]$RootPath)
  return Join-Path $RootPath $script:IntegrityManifestFileName
}

function Build-IntegrityManifest {
  param(
    [string]$RootPath,
    [hashtable]$Selection
  )

  $entries = New-Object System.Collections.Generic.List[object]

  $requiredRelative = @("Start-CourseForge.cmd", "Check-For-CourseForge-Updates.cmd", "package-manifest.json", "README.md", "CHANGELOG.md", "LICENSE", "Uninstall-CourseForge-Windows.cmd")
  if ($Selection.webapp) {
    $requiredRelative += @("webapp/index.html")
  }
  if ($Selection.extension) {
    $requiredRelative += @("extension/manifest.json")
  }

  foreach ($relative in $requiredRelative) {
    $target = Join-Path $RootPath $relative
    if (Test-Path $target) {
      $hash = (Get-FileHash -Path $target -Algorithm SHA256).Hash
      $entries.Add([ordered]@{ path = $relative; hash = $hash })
    }
  }

  $manifest = [ordered]@{
    generatedAtUtc = Get-TimestampString
    version = $script:ProductVersion
    files = $entries
  }

  return $manifest
}

function Write-IntegrityManifest {
  param(
    [string]$RootPath,
    [hashtable]$Selection
  )

  $manifestPath = Get-IntegrityManifestPath -RootPath $RootPath
  $manifest = Build-IntegrityManifest -RootPath $RootPath -Selection $Selection
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $manifestPath -Encoding ASCII
  Write-InstallerLog "Wrote integrity manifest: $manifestPath"
}

function Test-Integrity {
  param([string]$ResolvedInstallPath)

  $manifestPath = Get-IntegrityManifestPath -RootPath $ResolvedInstallPath
  if (-not (Test-Path $manifestPath)) {
    return [ordered]@{ ok = $false; issues = @("Integrity manifest missing.") }
  }

  $manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
  $issues = New-Object System.Collections.Generic.List[string]

  foreach ($entry in $manifest.files) {
    $target = Join-Path $ResolvedInstallPath $entry.path
    if (-not (Test-Path $target)) {
      $issues.Add("Missing file: $($entry.path)")
      continue
    }

    $actual = (Get-FileHash -Path $target -Algorithm SHA256).Hash
    if (-not [System.StringComparer]::OrdinalIgnoreCase.Equals($actual, [string]$entry.hash)) {
      $issues.Add("Corrupted file: $($entry.path)")
    }
  }

  return [ordered]@{
    ok = ($issues.Count -eq 0)
    issues = @($issues)
  }
}

function Copy-ComponentFiles {
  param(
    [string]$SourceRoot,
    [string]$ResolvedInstallPath,
    [hashtable]$Selection
  )

  Ensure-Directory -Path $ResolvedInstallPath

  if ($Selection.webapp) {
    Ensure-Directory -Path (Join-Path $ResolvedInstallPath "webapp")
    $null = robocopy (Join-Path $SourceRoot "webapp") (Join-Path $ResolvedInstallPath "webapp") /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -gt 7) {
      throw "Failed copying webapp with robocopy exit code $LASTEXITCODE"
    }
  }

  if ($Selection.extension) {
    Ensure-Directory -Path (Join-Path $ResolvedInstallPath "extension")
    $null = robocopy (Join-Path $SourceRoot "extension") (Join-Path $ResolvedInstallPath "extension") /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -gt 7) {
      throw "Failed copying extension with robocopy exit code $LASTEXITCODE"
    }
  }

  $supportFiles = @(
    "AutoUpdate-CourseForge.ps1",
    "Check-For-CourseForge-Updates.cmd",
    "Start-CourseForge.cmd",
    "CourseForge-Start.url",
    "Install-CourseForge-Windows.ps1",
    "Install-CourseForge-Windows.cmd",
    "Uninstall-CourseForge-Windows.cmd",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "package-manifest.json"
  )

  foreach ($file in $supportFiles) {
    $source = Join-Path $SourceRoot $file
    if (Test-Path $source) {
      Copy-Item -Path $source -Destination (Join-Path $ResolvedInstallPath $file) -Force
    }
  }

  if (Test-Path (Get-IntegrityManifestPath -RootPath $SourceRoot)) {
    Copy-Item -Path (Get-IntegrityManifestPath -RootPath $SourceRoot) -Destination (Get-IntegrityManifestPath -RootPath $ResolvedInstallPath) -Force
  }

  if (-not $Selection.webapp -and (Test-Path (Join-Path $ResolvedInstallPath "webapp"))) {
    Remove-Item -Path (Join-Path $ResolvedInstallPath "webapp") -Recurse -Force
  }

  if (-not $Selection.extension -and (Test-Path (Join-Path $ResolvedInstallPath "extension"))) {
    Remove-Item -Path (Join-Path $ResolvedInstallPath "extension") -Recurse -Force
  }
}

function Write-InstallerMetadata {
  param(
    [string]$ResolvedInstallPath,
    [hashtable]$Selection,
    [hashtable]$Icons,
    [string]$InstallPathSource,
    [string]$Mode
  )

  $metadataPath = Join-Path $ResolvedInstallPath $script:InstallerMetadataFileName
  $registry = Read-RegistryState
  $metadata = [ordered]@{
    productName = "CourseForge"
    version = $script:ProductVersion
    installPath = $ResolvedInstallPath
    installPathSource = $InstallPathSource
    installedAtUtc = Get-TimestampString
    updatedAtUtc = Get-TimestampString
    components = [ordered]@{
      webapp = [bool]$Selection.webapp
      extension = [bool]$Selection.extension
    }
    icons = [ordered]@{
      desktop = [bool]$Icons.desktop
      startMenu = [bool]$Icons.startMenu
    }
    localDataPath = $script:DataRoot
    packageManifestPath = (Join-Path $ResolvedInstallPath "package-manifest.json")
    integrityManifestPath = (Get-IntegrityManifestPath -RootPath $ResolvedInstallPath)
    registryMap = $registry
    shortcutState = Get-ShortcutState
    rollbackSnapshotPath = (Join-Path $script:RollbackRoot $script:RollingSnapshotFileName)
    mode = $Mode
  }

  $metadata | ConvertTo-Json -Depth 8 | Set-Content -Path $metadataPath -Encoding ASCII
  Write-InstallerLog "Wrote installer metadata: $metadataPath"
}

function New-RollbackSnapshot {
  param(
    [string]$ResolvedInstallPath,
    [hashtable]$CurrentSelection,
    [hashtable]$CurrentIcons
  )

  Ensure-Directory -Path $script:RollbackRoot

  $snapshotDir = Join-Path $script:RollbackRoot ("snapshot-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  Ensure-Directory -Path $snapshotDir

  $backupPath = Join-Path $snapshotDir "install-backup"
  $snapshotPath = Join-Path $snapshotDir $script:RollingSnapshotFileName

  if (Test-Path $ResolvedInstallPath) {
    Ensure-Directory -Path $backupPath
    $null = robocopy $ResolvedInstallPath $backupPath /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -gt 7) {
      throw "Could not snapshot current install directory (robocopy code $LASTEXITCODE)."
    }
  }

  $snapshot = [ordered]@{
    capturedAtUtc = Get-TimestampString
    installPath = $ResolvedInstallPath
    backupPath = $backupPath
    components = [ordered]@{
      webapp = [bool]$CurrentSelection.webapp
      extension = [bool]$CurrentSelection.extension
    }
    icons = [ordered]@{
      desktop = [bool]$CurrentIcons.desktop
      startMenu = [bool]$CurrentIcons.startMenu
    }
    shortcuts = Get-ShortcutState
    registry = Read-RegistryState
  }

  $snapshot | ConvertTo-Json -Depth 10 | Set-Content -Path $snapshotPath -Encoding ASCII
  return [ordered]@{ snapshot = $snapshot; snapshotPath = $snapshotPath }
}

function Restore-RollbackSnapshot {
  param([hashtable]$SnapshotEnvelope)

  Initialize-Log -Mode "rollback"
  Write-InstallerLog "Rollback started."

  $snapshot = $SnapshotEnvelope.snapshot
  $installPath = [string]$snapshot.installPath
  $backupPath = [string]$snapshot.backupPath

  if (Test-Path $backupPath) {
    Ensure-Directory -Path $installPath
    $null = robocopy $backupPath $installPath /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -gt 7) {
      Write-InstallerLog "Rollback file restore failed with code $LASTEXITCODE"
    }
    else {
      Write-InstallerLog "Rollback file restore completed."
    }
  }

  $registry = $snapshot.registry
  if ($null -ne $registry) {
    try {
      Write-RegistryState -InstallPath ([string]$registry.InstallPath) -WebappInstalled ([bool]$registry.WebappInstalled) -ExtensionInstalled ([bool]$registry.ExtensionInstalled) -DesktopIconInstalled ([bool]$registry.DesktopIconInstalled) -StartMenuIconInstalled ([bool]$registry.StartMenuIconInstalled) -LastRepairTimestamp ([string]$registry.LastRepairTimestamp) -SilentInstallAllowed ([bool]$registry.SilentInstallAllowed)
      Write-InstallerLog "Rollback restored registry map."
    }
    catch {
      Write-InstallerLog "Rollback failed to restore registry map: $($_.Exception.Message)"
    }
  }

  Set-Shortcuts -ResolvedInstallPath $installPath -CreateDesktop ([bool]$snapshot.icons.desktop) -CreateStartMenu ([bool]$snapshot.icons.startMenu)
  Write-InstallerLog "Rollback restored shortcuts."
}

function Verify-Install {
  param(
    [string]$ResolvedInstallPath,
    [hashtable]$Selection,
    [hashtable]$Icons
  )

  $issues = New-Object System.Collections.Generic.List[string]

  if ($Selection.webapp -and -not (Test-Path (Join-Path $ResolvedInstallPath "webapp\index.html"))) {
    $issues.Add("Webapp component missing after install.")
  }

  if ($Selection.extension -and -not (Test-Path (Join-Path $ResolvedInstallPath "extension\manifest.json"))) {
    $issues.Add("Browser extension component missing after install.")
  }

  if (-not (Test-Path (Join-Path $ResolvedInstallPath "package-manifest.json"))) {
    $issues.Add("package-manifest.json missing after install.")
  }

  if (-not (Test-Path (Join-Path $ResolvedInstallPath $script:InstallerMetadataFileName))) {
    $issues.Add("installer-metadata.json missing after install.")
  }

  if ($Icons.desktop -and -not (Test-Path (Get-DesktopShortcutPath))) {
    $issues.Add("Desktop shortcut missing after install.")
  }

  if ($Icons.startMenu -and -not (Test-Path (Join-Path (Get-StartMenuFolder) "CourseForge Webapp.lnk"))) {
    $issues.Add("Start menu shortcut missing after install.")
  }

  $integrity = Test-Integrity -ResolvedInstallPath $ResolvedInstallPath
  if (-not $integrity.ok) {
    foreach ($issue in $integrity.issues) {
      $issues.Add($issue)
    }
  }

  return [ordered]@{
    ok = ($issues.Count -eq 0)
    issues = @($issues)
  }
}

function Repair-Installation {
  param(
    [string]$SourceRoot,
    [string]$ResolvedInstallPath,
    [hashtable]$Selection,
    [hashtable]$Icons
  )

  Initialize-Log -Mode "repair"
  Write-InstallerLog "Repair mode started."

  $integrity = Test-Integrity -ResolvedInstallPath $ResolvedInstallPath
  if (-not $integrity.ok) {
    foreach ($issue in $integrity.issues) {
      Write-InstallerLog "Repair issue detected: $issue"
    }
  }

  Copy-ComponentFiles -SourceRoot $SourceRoot -ResolvedInstallPath $ResolvedInstallPath -Selection $Selection

  if ($Selection.extension) {
    $targetManifest = Join-Path $ResolvedInstallPath "extension\manifest.json"
    $sourceManifest = Join-Path $SourceRoot "extension\manifest.json"
    if ((-not (Test-Path $targetManifest)) -and (Test-Path $sourceManifest)) {
      Copy-Item -Path $sourceManifest -Destination $targetManifest -Force
      Write-InstallerLog "Rebuilt missing extension manifest."
    }
  }

  Set-Shortcuts -ResolvedInstallPath $ResolvedInstallPath -CreateDesktop ([bool]$Icons.desktop) -CreateStartMenu ([bool]$Icons.startMenu)
  Write-IntegrityManifest -RootPath $ResolvedInstallPath -Selection $Selection

  Write-InstallerMetadata -ResolvedInstallPath $ResolvedInstallPath -Selection $Selection -Icons $Icons -InstallPathSource "repair" -Mode "repair"
  Write-RegistryState -InstallPath $ResolvedInstallPath -WebappInstalled ([bool]$Selection.webapp) -ExtensionInstalled ([bool]$Selection.extension) -DesktopIconInstalled ([bool]$Icons.desktop) -StartMenuIconInstalled ([bool]$Icons.startMenu) -LastRepairTimestamp (Get-TimestampString)

  $verification = Verify-Install -ResolvedInstallPath $ResolvedInstallPath -Selection $Selection -Icons $Icons
  if (-not $verification.ok) {
    throw ("Repair verification failed: " + ($verification.issues -join "; "))
  }

  Write-InstallerLog "Repair completed successfully."
}

function Uninstall-CourseForge {
  param(
    [string]$ResolvedInstallPath,
    [hashtable]$InstalledSelection,
    [hashtable]$Icons
  )

  Initialize-Log -Mode "uninstall"

  $runningLock = Join-Path $script:DataRoot "courseforge.running.lock"
  if (Test-Path $runningLock) {
    throw "CourseForge appears to be running. Close the app before uninstalling."
  }

  $removeSelection = [ordered]@{
    webapp = [bool]$InstalledSelection.webapp
    extension = [bool]$InstalledSelection.extension
    removeUserData = [bool]$RemoveUserData
  }

  if (-not $Silent -and -not $FullAuto) {
    $confirmed = Read-YesNo -Prompt "Are you sure you want to uninstall CourseForge" -DefaultValue $true
    if (-not $confirmed) {
      throw "Uninstall cancelled by user."
    }

    $removeSelection.webapp = Read-YesNo -Prompt "Remove Webapp" -DefaultValue ([bool]$InstalledSelection.webapp)
    $removeSelection.extension = Read-YesNo -Prompt "Remove Browser Extension" -DefaultValue ([bool]$InstalledSelection.extension)
    $removeSelection.removeUserData = Read-YesNo -Prompt "Delete all local user data (NOT recommended)" -DefaultValue $false
  }

  if (-not $removeSelection.webapp -and -not $removeSelection.extension) {
    throw "Uninstall blocked because no components were selected."
  }

  if ($removeSelection.webapp -and (Test-Path (Join-Path $ResolvedInstallPath "webapp"))) {
    Remove-Item -Path (Join-Path $ResolvedInstallPath "webapp") -Recurse -Force
    Write-InstallerLog "Removed webapp directory."
  }

  if ($removeSelection.extension -and (Test-Path (Join-Path $ResolvedInstallPath "extension"))) {
    Remove-Item -Path (Join-Path $ResolvedInstallPath "extension") -Recurse -Force
    Write-InstallerLog "Removed extension directory."
  }

  Remove-Shortcuts
  Write-InstallerLog "Removed shortcuts."

  $remainingWebapp = Test-Path (Join-Path $ResolvedInstallPath "webapp")
  $remainingExtension = Test-Path (Join-Path $ResolvedInstallPath "extension")

  if (-not $remainingWebapp -and -not $remainingExtension) {
    Remove-RegistryState
    Write-InstallerLog "Removed registry map."

    $metaFiles = @(
      $script:InstallerMetadataFileName,
      $script:IntegrityManifestFileName,
      $script:RollingSnapshotFileName,
      "Install-CourseForge-Windows.ps1",
      "Install-CourseForge-Windows.cmd",
      "Uninstall-CourseForge-Windows.cmd"
    )

    foreach ($meta in $metaFiles) {
      $target = Join-Path $ResolvedInstallPath $meta
      if (Test-Path $target) {
        Remove-Item -Path $target -Force -ErrorAction SilentlyContinue
      }
    }

    if ((Test-Path $ResolvedInstallPath) -and ((Get-ChildItem -Path $ResolvedInstallPath -Force | Measure-Object).Count -eq 0)) {
      Remove-Item -Path $ResolvedInstallPath -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  else {
    Write-RegistryState -InstallPath $ResolvedInstallPath -WebappInstalled $remainingWebapp -ExtensionInstalled $remainingExtension -DesktopIconInstalled $false -StartMenuIconInstalled $false -LastRepairTimestamp ""
  }

  if ($removeSelection.removeUserData -and (Test-Path $script:DataRoot)) {
    Remove-Item -Path $script:DataRoot -Recurse -Force
    Write-InstallerLog "Removed local user data."
  }

  $verificationIssues = New-Object System.Collections.Generic.List[string]
  if ($removeSelection.webapp -and (Test-Path (Join-Path $ResolvedInstallPath "webapp"))) {
    $verificationIssues.Add("Webapp directory still exists.")
  }
  if ($removeSelection.extension -and (Test-Path (Join-Path $ResolvedInstallPath "extension"))) {
    $verificationIssues.Add("Extension directory still exists.")
  }
  if (Test-Path (Get-DesktopShortcutPath)) {
    $verificationIssues.Add("Desktop shortcut still exists.")
  }
  if (Test-Path (Get-StartMenuFolder)) {
    $verificationIssues.Add("Start menu folder still exists.")
  }
  if (-not $remainingWebapp -and -not $remainingExtension -and (Test-Path $script:RegistryPath)) {
    $verificationIssues.Add("Registry map still exists.")
  }

  if ($verificationIssues.Count -gt 0) {
    throw ("Uninstall verification failed: " + ($verificationIssues -join "; "))
  }

  Write-InstallerLog "Uninstall completed successfully."
}

function Invoke-WithRollback {
  param(
    [scriptblock]$Operation,
    [string]$ResolvedInstallPath,
    [hashtable]$CurrentSelection,
    [hashtable]$CurrentIcons
  )

  $snapshotEnvelope = New-RollbackSnapshot -ResolvedInstallPath $ResolvedInstallPath -CurrentSelection $CurrentSelection -CurrentIcons $CurrentIcons
  Write-InstallerLog "Rollback snapshot created: $($snapshotEnvelope.snapshotPath)"

  try {
    & $Operation
  }
  catch {
    Write-InstallerLog "Operation failed; initiating rollback: $($_.Exception.Message)"
    Restore-RollbackSnapshot -SnapshotEnvelope $snapshotEnvelope
    throw
  }
}

Normalize-LegacyInstallerSwitches

if ($FullAuto) {
  $Silent = $true
  $InstallBoth = $true
  $NoDesktopIcon = $false
  $NoStartMenuIcon = $false
}

$modeForLog = if ($FullAuto) { "fullauto" } elseif ($Silent) { "silent" } elseif ($Repair) { "repair" } elseif ($Uninstall) { "uninstall" } else { "install" }
Initialize-Log -Mode $modeForLog

try {
  Ensure-Directory -Path $script:DataRoot
  Ensure-Directory -Path $script:RollbackRoot

  $sourceRoot = Split-Path -Parent $PSCommandPath
  $resolvedInstallPath = Get-EffectiveInstallPath -RequestedPath $InstallPath
  $detection = Detect-Installation -ResolvedInstallPath $resolvedInstallPath

  $menuChoice = Show-InitialDetectionMenu -IsInstalled ([bool]$detection.isInstalled)

  if ($menuChoice -eq "exit") {
    Write-InstallerLog "User exited installer from detection screen."
    exit 3
  }

  if ($menuChoice -eq "fullauto") {
    $FullAuto = $true
    $Silent = $true
    $InstallBoth = $true
  }

  if ($menuChoice -eq "modify") { $Modify = $true }
  if ($menuChoice -eq "repair") { $Repair = $true }
  if ($menuChoice -eq "uninstall") { $Uninstall = $true }

  if ($Uninstall) {
    $installedSelection = [ordered]@{
      webapp = [bool]$detection.webappInstalled
      extension = [bool]$detection.extensionInstalled
    }

    $iconsFromRegistry = Read-RegistryState
    $icons = [ordered]@{
      desktop = if ($null -ne $iconsFromRegistry) { [bool]$iconsFromRegistry.DesktopIconInstalled } else { $true }
      startMenu = if ($null -ne $iconsFromRegistry) { [bool]$iconsFromRegistry.StartMenuIconInstalled } else { $true }
    }

    Invoke-WithRollback -ResolvedInstallPath $resolvedInstallPath -CurrentSelection $installedSelection -CurrentIcons $icons -Operation {
      Uninstall-CourseForge -ResolvedInstallPath $resolvedInstallPath -InstalledSelection $installedSelection -Icons $icons
    }

    Write-Host "CourseForge uninstall completed."
    Show-CompletionDialog -Success $true -Body "CourseForge uninstall completed successfully."
    exit 0
  }

  $defaultSelection = if ($Modify -and $detection.isInstalled) {
    [ordered]@{ webapp = [bool]$detection.webappInstalled; extension = [bool]$detection.extensionInstalled }
  }
  else {
    [ordered]@{ webapp = $true; extension = $true }
  }

  $selection = Resolve-ComponentSelection -DefaultWebapp ([bool]$defaultSelection.webapp) -DefaultExtension ([bool]$defaultSelection.extension) -Mode (if ($Modify) { "modify" } elseif ($Repair) { "repair" } else { "install" })
  $icons = if ($Repair) {
    $registry = Read-RegistryState
    [ordered]@{
      desktop = if ($null -ne $registry) { [bool]$registry.DesktopIconInstalled } else { $true }
      startMenu = if ($null -ne $registry) { [bool]$registry.StartMenuIconInstalled } else { $true }
    }
  }
  else {
    Resolve-IconSelection
  }

  $installPathSource = if ([string]::IsNullOrWhiteSpace($InstallPath)) { "default" } else { "cli-argument" }

  if ($Repair) {
    Invoke-WithRollback -ResolvedInstallPath $resolvedInstallPath -CurrentSelection $defaultSelection -CurrentIcons $icons -Operation {
      Repair-Installation -SourceRoot $sourceRoot -ResolvedInstallPath $resolvedInstallPath -Selection $selection -Icons $icons
    }
  }
  else {
    Invoke-WithRollback -ResolvedInstallPath $resolvedInstallPath -CurrentSelection $defaultSelection -CurrentIcons $icons -Operation {
      Copy-ComponentFiles -SourceRoot $sourceRoot -ResolvedInstallPath $resolvedInstallPath -Selection $selection
      Set-Shortcuts -ResolvedInstallPath $resolvedInstallPath -CreateDesktop ([bool]$icons.desktop) -CreateStartMenu ([bool]$icons.startMenu)
      Write-IntegrityManifest -RootPath $resolvedInstallPath -Selection $selection
      Write-InstallerMetadata -ResolvedInstallPath $resolvedInstallPath -Selection $selection -Icons $icons -InstallPathSource $installPathSource -Mode (if ($Modify) { "modify" } elseif ($FullAuto) { "fullauto" } elseif ($Silent) { "silent" } else { "install" })
      Write-RegistryState -InstallPath $resolvedInstallPath -WebappInstalled ([bool]$selection.webapp) -ExtensionInstalled ([bool]$selection.extension) -DesktopIconInstalled ([bool]$icons.desktop) -StartMenuIconInstalled ([bool]$icons.startMenu) -LastRepairTimestamp ""

      $verification = Verify-Install -ResolvedInstallPath $resolvedInstallPath -Selection $selection -Icons $icons
      if (-not $verification.ok) {
        throw ("Install verification failed: " + ($verification.issues -join "; "))
      }
    }
  }

  Write-InstallerLog "Operation completed successfully for mode=$modeForLog path=$resolvedInstallPath"
  Write-Host "CourseForge operation completed successfully."
  Write-Host "InstallPath: $resolvedInstallPath"
  Show-CompletionDialog -Success $true -Body "CourseForge setup completed successfully."
  exit 0
}
catch {
  Write-InstallerLog "Fatal installer error: $($_.Exception.Message)"
  Write-Error $_
  Show-CompletionDialog -Success $false -Body ("CourseForge setup failed: " + $_.Exception.Message)
  exit 1
}
