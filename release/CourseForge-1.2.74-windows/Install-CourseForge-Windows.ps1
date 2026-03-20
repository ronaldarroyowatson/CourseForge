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
$script:ProductVersion = "1.2.74"
$script:RegistryPath = "HKCU:\Software\CourseForge"
$script:UninstallRegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CourseForge"
$script:UserRoot = Join-Path $env:LOCALAPPDATA "CourseForge"
$script:LogsRoot = Join-Path $script:UserRoot "logs"
$script:DataRoot = Join-Path $script:UserRoot "data"
$script:RollbackRoot = Join-Path $script:UserRoot "rollback"
$script:DefaultInstallPath = Join-Path (Join-Path $env:LOCALAPPDATA "Programs") "CourseForge"
$script:InstallerMetadataFileName = "installer-metadata.json"
$script:IntegrityManifestFileName = "installer-integrity.json"
$script:RollingSnapshotFileName = "installer-rollback-snapshot.json"
$script:BundledNodeFolderName = "node-runtime"
$script:PortableNodeVersion = "20.19.5"
$script:PortableNodeZipUrlTemplate = "https://nodejs.org/dist/v{0}/node-v{0}-win-x64.zip"
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

function New-InstallerSupportCode {
  return ([Guid]::NewGuid().ToString("N").Substring(0, 8).ToUpperInvariant())
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

function Get-BundledNodeRuntimePath {
  param([string]$ResolvedInstallPath)
  return Join-Path $ResolvedInstallPath $script:BundledNodeFolderName
}

function Get-UserPathSegments {
  try {
    $raw = [Environment]::GetEnvironmentVariable("Path", "User")
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return @()
    }

    return @($raw.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  }
  catch {
    return @()
  }
}

function Set-UserPathSegments {
  param([string[]]$Segments)

  $normalized = @($Segments | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  [Environment]::SetEnvironmentVariable("Path", ($normalized -join ';'), "User")
  $env:Path = (($env:Path -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) + $normalized | Select-Object -Unique) -join ';'
}

function Remove-StaleNodePathEntries {
  $segments = Get-UserPathSegments
  if ($segments.Count -eq 0) {
    return
  }

  $clean = New-Object System.Collections.Generic.List[string]
  foreach ($segment in $segments) {
    $candidate = $segment.Trim()
    $looksNodePath = $candidate -match '(?i)\\nodejs\\?$' -or $candidate -match '(?i)courseforge\\node-runtime\\?$'
    if ($looksNodePath -and -not (Test-Path $candidate)) {
      Write-InstallerLog "Removed stale Node PATH entry: $candidate"
      continue
    }

    $clean.Add($candidate)
  }

  Set-UserPathSegments -Segments @($clean)
}

function Add-PathIfMissing {
  param([string]$PathEntry)

  if ([string]::IsNullOrWhiteSpace($PathEntry)) {
    return
  }

  $segments = Get-UserPathSegments
  $exists = $segments | Where-Object { [System.StringComparer]::OrdinalIgnoreCase.Equals($_, $PathEntry) } | Select-Object -First 1
  if ($null -ne $exists) {
    return
  }

  Set-UserPathSegments -Segments @($segments + $PathEntry)
}

function Test-NodeExecutable {
  param([string]$NodePath)

  if ([string]::IsNullOrWhiteSpace($NodePath) -or -not (Test-Path $NodePath)) {
    return [ordered]@{ ok = $false; reason = "node.exe was not found." }
  }

  try {
    $nodeVersion = (& $NodePath -v 2>&1 | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($nodeVersion) -or -not $nodeVersion.StartsWith("v")) {
      return [ordered]@{ ok = $false; reason = "node -v returned an unexpected response." }
    }

    $npmCmdPath = Join-Path (Split-Path $NodePath -Parent) "npm.cmd"
    if (-not (Test-Path $npmCmdPath)) {
      return [ordered]@{ ok = $false; reason = "npm.cmd is missing." }
    }

    $npmVersion = (& $npmCmdPath -v 2>&1 | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($npmVersion)) {
      return [ordered]@{ ok = $false; reason = "npm -v returned an empty response." }
    }

    return [ordered]@{
      ok = $true
      nodeVersion = $nodeVersion
      npmVersion = $npmVersion
    }
  }
  catch {
    return [ordered]@{ ok = $false; reason = $_.Exception.Message }
  }
}

function Get-NodeInstallHealth {
  param([string]$ResolvedInstallPath)

  $bundledRuntimePath = Get-BundledNodeRuntimePath -ResolvedInstallPath $ResolvedInstallPath
  $bundledNodeExe = Join-Path $bundledRuntimePath "node.exe"
  $bundledHealth = Test-NodeExecutable -NodePath $bundledNodeExe
  if ($bundledHealth.ok) {
    return [ordered]@{
      source = "bundled"
      nodePath = $bundledNodeExe
      nodeVersion = $bundledHealth.nodeVersion
      npmVersion = $bundledHealth.npmVersion
      healthy = $true
    }
  }

  $globalNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -ne $globalNode) {
    $globalHealth = Test-NodeExecutable -NodePath $globalNode.Source
    if ($globalHealth.ok) {
      return [ordered]@{
        source = "global"
        nodePath = $globalNode.Source
        nodeVersion = $globalHealth.nodeVersion
        npmVersion = $globalHealth.npmVersion
        healthy = $true
      }
    }

    return [ordered]@{
      source = "global"
      nodePath = $globalNode.Source
      healthy = $false
      reason = $globalHealth.reason
    }
  }

  $systemNodePath = "C:\Program Files\nodejs"
  $looksCorruptedSystemNode = (Test-Path $systemNodePath) -and -not (Test-Path (Join-Path $systemNodePath "node.exe"))

  return [ordered]@{
    source = "none"
    nodePath = ""
    healthy = $false
    looksCorruptedSystemNode = $looksCorruptedSystemNode
    reason = if ($looksCorruptedSystemNode) { "System Node.js folder exists without node.exe." } else { "Node.js was not detected." }
  }
}

function Write-NodeEnvironmentDiagnostics {
  param([hashtable]$Health)

  $pathPreview = @($env:Path -split ';' | Select-Object -First 12) -join ';'
  $runtimeState = if ($Health.healthy) { "healthy" } else { "unhealthy" }
  Write-InstallerLog "Node diagnostics: state=$runtimeState source=$($Health.source) nodePath=$($Health.nodePath) nodeVersion=$($Health.nodeVersion) npmVersion=$($Health.npmVersion)"
  Write-InstallerLog "Node diagnostics PATH preview: $pathPreview"

  $orphanedFolders = @()
  foreach ($candidate in @("C:\Program Files\nodejs")) {
    if ((Test-Path $candidate) -and -not (Test-Path (Join-Path $candidate "node.exe"))) {
      $orphanedFolders += $candidate
    }
  }

  if ($orphanedFolders.Count -gt 0) {
    Write-InstallerLog "Node diagnostics orphaned folders: $($orphanedFolders -join ', ')"
  }
}

function Install-BundledNodeRuntime {
  param([string]$ResolvedInstallPath)

  $runtimeRoot = Get-BundledNodeRuntimePath -ResolvedInstallPath $ResolvedInstallPath
  Ensure-Directory -Path $runtimeRoot

  $downloadRoot = Join-Path $script:DataRoot "downloads"
  Ensure-Directory -Path $downloadRoot
  $zipPath = Join-Path $downloadRoot ("node-v{0}-win-x64.zip" -f $script:PortableNodeVersion)
  $extractPath = Join-Path $downloadRoot ("node-extract-{0}" -f ([Guid]::NewGuid().ToString("N")))
  Ensure-Directory -Path $extractPath

  $url = [string]::Format($script:PortableNodeZipUrlTemplate, $script:PortableNodeVersion)
  Write-InstallerLog "Downloading portable Node.js from $url"
  Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

  Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
  $expandedFolder = Get-ChildItem -Path $extractPath -Directory | Where-Object { $_.Name -like "node-v*-win-x64" } | Select-Object -First 1
  if ($null -eq $expandedFolder) {
    throw "Portable Node.js archive did not contain expected folder layout."
  }

  Remove-Item -Path $runtimeRoot -Recurse -Force -ErrorAction SilentlyContinue
  Ensure-Directory -Path $runtimeRoot
  $null = robocopy $expandedFolder.FullName $runtimeRoot /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -gt 7) {
    throw "Failed to place bundled Node.js runtime (robocopy code $LASTEXITCODE)."
  }

  Remove-Item -Path $extractPath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue

  $nodeExe = Join-Path $runtimeRoot "node.exe"
  $health = Test-NodeExecutable -NodePath $nodeExe
  if (-not $health.ok) {
    throw "Bundled Node.js failed validation: $($health.reason)"
  }

  Add-PathIfMissing -PathEntry $runtimeRoot
  Write-InstallerLog "Bundled Node.js ready at $runtimeRoot ($($health.nodeVersion), npm $($health.npmVersion))."
}

function Ensure-NodeDependency {
  param([string]$ResolvedInstallPath)

  Remove-StaleNodePathEntries
  $health = Get-NodeInstallHealth -ResolvedInstallPath $ResolvedInstallPath
  Write-NodeEnvironmentDiagnostics -Health $health
  if ($health.healthy) {
    Write-InstallerLog "Node.js dependency is healthy from $($health.source): $($health.nodeVersion), npm $($health.npmVersion)."
    return
  }

  if ($health.looksCorruptedSystemNode) {
    Write-InstallerLog "Detected corrupted system Node.js folder. Attempting cleanup of orphaned folder and PATH entries."
    try {
      Remove-Item -Path "C:\Program Files\nodejs" -Recurse -Force -ErrorAction Stop
      Write-InstallerLog "Removed orphaned C:\Program Files\nodejs folder."
    }
    catch {
      Write-InstallerLog "Could not remove C:\Program Files\nodejs (non-admin or locked). Continuing with bundled Node.js."
    }
  }

  Write-Host "Installing Node.js... This may take a moment."
  Write-InstallerLog "Installing bundled Node.js runtime because dependency check failed: $($health.reason)"
  Install-BundledNodeRuntime -ResolvedInstallPath $ResolvedInstallPath
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
  $legacySwitches = @(
    "/SILENT",
    "/FULLAUTO",
    "/INSTALL_WEBAPP",
    "/INSTALL_EXTENSION",
    "/INSTALL_BOTH",
    "/NO_DESKTOP_ICON",
    "/NO_STARTMENU_ICON",
    "/REPAIR",
    "/UNINSTALL",
    "/MODIFY",
    "/REMOVE_USER_DATA"
  )

  if (-not [string]::IsNullOrWhiteSpace($script:InstallPath)) {
    $normalizedInstallPath = $script:InstallPath.Trim().ToUpperInvariant()
    if ($legacySwitches -contains $normalizedInstallPath) {
      $script:InstallPath = ""
    }
  }

  for ($i = 0; $i -lt $args.Count; $i++) {
    $arg = [string]$args[$i]
    $normalized = $arg.ToUpperInvariant()

    switch ($normalized) {
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
      "/INSTALLPATH" {
        if ($i + 1 -lt $args.Count) {
          $script:InstallPath = [string]$args[$i + 1]
          $i++
        }
        continue
      }
    }

    if ($normalized.StartsWith("/INSTALLPATH=")) {
      $script:InstallPath = $arg.Substring(13)
      continue
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

function Get-AppIconPath {
  param([string]$ResolvedInstallPath)

  $iconPath = Join-Path $ResolvedInstallPath "CourseForge.ico"
  if (Test-Path $iconPath) {
    return $iconPath
  }

  return "$env:SystemRoot\System32\SHELL32.dll,220"
}

function Write-UninstallRegistration {
  param([string]$ResolvedInstallPath)

  if (-not (Test-Path $script:UninstallRegistryPath)) {
    New-Item -Path $script:UninstallRegistryPath -Force | Out-Null
  }

  # UninstallString shows GUI when user clicks Uninstall from Windows Settings
  $uninstallCmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}" -InstallPath "{1}"' -f (Join-Path $ResolvedInstallPath "Launch-CourseForge-Uninstaller-GUI.ps1"), $ResolvedInstallPath
  # QuietUninstallString is used for silent/scripted uninstalls
  $quietUninstallCmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}" -Silent -Uninstall' -f (Join-Path $ResolvedInstallPath "Install-CourseForge-Windows.ps1")

  New-ItemProperty -Path $script:UninstallRegistryPath -Name "DisplayName" -Value $script:ProductName -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $script:UninstallRegistryPath -Name "DisplayVersion" -Value $script:ProductVersion -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $script:UninstallRegistryPath -Name "Publisher" -Value "CourseForge" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $script:UninstallRegistryPath -Name "InstallLocation" -Value $ResolvedInstallPath -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $script:UninstallRegistryPath -Name "DisplayIcon" -Value (Get-AppIconPath -ResolvedInstallPath $ResolvedInstallPath) -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $script:UninstallRegistryPath -Name "UninstallString" -Value $uninstallCmd -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $script:UninstallRegistryPath -Name "QuietUninstallString" -Value $quietUninstallCmd -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $script:UninstallRegistryPath -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $script:UninstallRegistryPath -Name "NoRepair" -Value 0 -PropertyType DWord -Force | Out-Null
}

function Remove-UninstallRegistration {
  if (Test-Path $script:UninstallRegistryPath) {
    Remove-Item -Path $script:UninstallRegistryPath -Recurse -Force -ErrorAction SilentlyContinue
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

function Get-StartMenuAppShortcutPath {
  return Join-Path (Get-StartMenuFolder) "CourseForge.lnk"
}

function Get-ShortcutState {
  return [ordered]@{
    desktop = Test-Path (Get-DesktopShortcutPath)
    startMenu = Test-Path (Get-StartMenuAppShortcutPath)
  }
}

function Read-UninstallRegistryState {
  if (-not (Test-Path $script:UninstallRegistryPath)) {
    return $null
  }

  try {
    $props = Get-ItemProperty -Path $script:UninstallRegistryPath
    return [ordered]@{
      InstallLocation = [string]$props.InstallLocation
      UninstallString = [string]$props.UninstallString
      QuietUninstallString = [string]$props.QuietUninstallString
      DisplayIcon = [string]$props.DisplayIcon
      DisplayVersion = [string]$props.DisplayVersion
    }
  }
  catch {
    Write-InstallerLog "Failed to read uninstall registry map: $($_.Exception.Message)"
    return $null
  }
}

function Get-ShortcutTargetPath {
  param([string]$ShortcutPath)

  if ([string]::IsNullOrWhiteSpace($ShortcutPath) -or -not (Test-Path $ShortcutPath)) {
    return $null
  }

  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    if ([string]::IsNullOrWhiteSpace($shortcut.TargetPath)) {
      return $null
    }

    return [string]$shortcut.TargetPath
  }
  catch {
    Write-InstallerLog "Could not read shortcut target for ${ShortcutPath}: $($_.Exception.Message)"
    return $null
  }
}

function Resolve-InstallRootFromShortcutTarget {
  param([string]$TargetPath)

  if ([string]::IsNullOrWhiteSpace($TargetPath)) {
    return $null
  }

  try {
    $resolved = [System.IO.Path]::GetFullPath($TargetPath)
  }
  catch {
    return $null
  }

  if (Test-Path $resolved -PathType Container) {
    if ([System.StringComparer]::OrdinalIgnoreCase.Equals([System.IO.Path]::GetFileName($resolved), "extension")) {
      return (Split-Path $resolved -Parent)
    }

    return $resolved
  }

  $leaf = [System.IO.Path]::GetFileName($resolved)
  if ($leaf -match '^(Start-CourseForge\.cmd|Install-CourseForge-Windows\.ps1|Install-CourseForge-Windows\.cmd|Uninstall-CourseForge-Windows\.cmd|CourseForge-Start\.url)$') {
    return (Split-Path $resolved -Parent)
  }

  return $null
}

function Get-InstallPathFromCommandLine {
  param([string]$CommandLine)

  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $null
  }

  $quotedMatch = [regex]::Match($CommandLine, '(?i)"([^"]+\\(?:Install-CourseForge-Windows\.ps1|Install-CourseForge-Windows\.cmd|Uninstall-CourseForge-Windows\.cmd|Launch-CourseForge-Uninstaller-GUI\.cmd|Launch-CourseForge-Uninstaller-GUI\.ps1|Start-CourseForge\.cmd))"')
  if ($quotedMatch.Success) {
    return (Split-Path $quotedMatch.Groups[1].Value -Parent)
  }

  $bareMatch = [regex]::Match($CommandLine, '(?i)([A-Z]:\\\S*?(?:Install-CourseForge-Windows\.ps1|Install-CourseForge-Windows\.cmd|Uninstall-CourseForge-Windows\.cmd|Launch-CourseForge-Uninstaller-GUI\.cmd|Launch-CourseForge-Uninstaller-GUI\.ps1|Start-CourseForge\.cmd))')
  if ($bareMatch.Success) {
    return (Split-Path $bareMatch.Groups[1].Value -Parent)
  }

  return $null
}

function Add-UniqueCandidatePath {
  param(
    [System.Collections.Generic.List[string]]$Candidates,
    [string]$Path
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return
  }

  try {
    $resolved = [System.IO.Path]::GetFullPath($Path)
  }
  catch {
    return
  }

  if (-not $Candidates.Contains($resolved)) {
    $Candidates.Add($resolved)
  }
}

function Get-InstallCandidateReport {
  param([string]$CandidatePath)

  if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
    return $null
  }

  try {
    $resolved = [System.IO.Path]::GetFullPath($CandidatePath)
  }
  catch {
    return $null
  }

  $metadataPath = Join-Path $resolved $script:InstallerMetadataFileName
  $webappIndexPath = Join-Path $resolved "webapp\index.html"
  $extensionManifestPath = Join-Path $resolved "extension\manifest.json"
  $startCmdPath = Join-Path $resolved "Start-CourseForge.cmd"
  $uninstallCmdPath = Join-Path $resolved "Uninstall-CourseForge-Windows.cmd"
  $packageManifestPath = Join-Path $resolved "package-manifest.json"
  $iconPath = Join-Path $resolved "CourseForge.ico"

  $markers = New-Object System.Collections.Generic.List[string]
  if (Test-Path $metadataPath) { $markers.Add("metadata") }
  if (Test-Path $webappIndexPath) { $markers.Add("webapp") }
  if (Test-Path $extensionManifestPath) { $markers.Add("extension") }
  if (Test-Path $startCmdPath) { $markers.Add("start-cmd") }
  if (Test-Path $uninstallCmdPath) { $markers.Add("uninstall-cmd") }
  if (Test-Path $packageManifestPath) { $markers.Add("package-manifest") }
  if (Test-Path $iconPath) { $markers.Add("icon") }

  return [ordered]@{
    path = $resolved
    exists = (Test-Path $resolved)
    isDetected = ($markers.Count -gt 0)
    markerCount = $markers.Count
    markers = @($markers)
    metadataPath = $metadataPath
    webappInstalled = (Test-Path (Join-Path $resolved "webapp"))
    extensionInstalled = (Test-Path (Join-Path $resolved "extension"))
  }
}

function Find-ExistingInstallations {
  param([string]$RequestedPath)

  $registry = Read-RegistryState
  $uninstall = Read-UninstallRegistryState
  $candidates = New-Object System.Collections.Generic.List[string]

  Add-UniqueCandidatePath -Candidates $candidates -Path $RequestedPath
  Add-UniqueCandidatePath -Candidates $candidates -Path $script:DefaultInstallPath

  if ($null -ne $registry) {
    Add-UniqueCandidatePath -Candidates $candidates -Path ([string]$registry.InstallPath)
  }

  if ($null -ne $uninstall) {
    Add-UniqueCandidatePath -Candidates $candidates -Path ([string]$uninstall.InstallLocation)
    Add-UniqueCandidatePath -Candidates $candidates -Path (Get-InstallPathFromCommandLine -CommandLine ([string]$uninstall.UninstallString))
    Add-UniqueCandidatePath -Candidates $candidates -Path (Get-InstallPathFromCommandLine -CommandLine ([string]$uninstall.QuietUninstallString))
    Add-UniqueCandidatePath -Candidates $candidates -Path (Resolve-InstallRootFromShortcutTarget -TargetPath ([string]$uninstall.DisplayIcon))
  }

  Add-UniqueCandidatePath -Candidates $candidates -Path (Get-InstallPathFromMetadata -CandidatePath $script:DefaultInstallPath)
  Add-UniqueCandidatePath -Candidates $candidates -Path (Resolve-InstallRootFromShortcutTarget -TargetPath (Get-ShortcutTargetPath -ShortcutPath (Get-DesktopShortcutPath)))
  Add-UniqueCandidatePath -Candidates $candidates -Path (Resolve-InstallRootFromShortcutTarget -TargetPath (Get-ShortcutTargetPath -ShortcutPath (Get-StartMenuAppShortcutPath)))
  Add-UniqueCandidatePath -Candidates $candidates -Path (Resolve-InstallRootFromShortcutTarget -TargetPath (Get-ShortcutTargetPath -ShortcutPath (Join-Path (Get-StartMenuFolder) "CourseForge Extension.lnk")))

  Add-UniqueCandidatePath -Candidates $candidates -Path (Join-Path $env:ProgramFiles "CourseForge")
  Add-UniqueCandidatePath -Candidates $candidates -Path (Join-Path ${env:ProgramFiles(x86)} "CourseForge")

  $reports = @()
  foreach ($candidate in $candidates) {
    $report = Get-InstallCandidateReport -CandidatePath $candidate
    if ($null -ne $report) {
      $reports += $report
    }
  }

  $detectedInstallations = @($reports | Where-Object { $_.isDetected } | Sort-Object @{ Expression = 'markerCount'; Descending = $true }, @{ Expression = 'path'; Descending = $false })

  $preferredInstallPath = $null
  if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
    try {
      $preferredInstallPath = [System.IO.Path]::GetFullPath($RequestedPath)
    }
    catch {
      $preferredInstallPath = $RequestedPath
    }
  }

  if ([string]::IsNullOrWhiteSpace($preferredInstallPath) -and $null -ne $registry -and -not [string]::IsNullOrWhiteSpace($registry.InstallPath)) {
    $registryPath = [System.IO.Path]::GetFullPath([string]$registry.InstallPath)
    $registryInstall = $detectedInstallations | Where-Object { $_.path -eq $registryPath } | Select-Object -First 1
    if ($null -ne $registryInstall) {
      $preferredInstallPath = $registryInstall.path
    }
  }

  if ([string]::IsNullOrWhiteSpace($preferredInstallPath) -and $null -ne $uninstall -and -not [string]::IsNullOrWhiteSpace($uninstall.InstallLocation)) {
    $uninstallPath = [System.IO.Path]::GetFullPath([string]$uninstall.InstallLocation)
    $uninstallInstall = $detectedInstallations | Where-Object { $_.path -eq $uninstallPath } | Select-Object -First 1
    if ($null -ne $uninstallInstall) {
      $preferredInstallPath = $uninstallInstall.path
    }
  }

  if ([string]::IsNullOrWhiteSpace($preferredInstallPath) -and $detectedInstallations.Count -gt 0) {
    $preferredInstallPath = [string]$detectedInstallations[0].path
  }

  if ([string]::IsNullOrWhiteSpace($preferredInstallPath)) {
    $preferredInstallPath = [System.IO.Path]::GetFullPath($script:DefaultInstallPath)
  }

  $primaryInstallation = $reports | Where-Object { $_.path -eq $preferredInstallPath } | Select-Object -First 1
  if ($null -eq $primaryInstallation) {
    $primaryInstallation = Get-InstallCandidateReport -CandidatePath $preferredInstallPath
  }

  $legacyInstallations = @($detectedInstallations | Where-Object { $_.path -ne $preferredInstallPath })

  return [ordered]@{
    preferredInstallPath = $preferredInstallPath
    primaryInstallation = $primaryInstallation
    detectedInstallations = $detectedInstallations
    legacyInstallations = $legacyInstallations
    registryState = $registry
    uninstallState = $uninstall
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
    [hashtable]$Selection,
    [bool]$CreateDesktop,
    [bool]$CreateStartMenu
  )

  $desktopShortcut = Get-DesktopShortcutPath
  $startMenuFolder = Get-StartMenuFolder
  $iconLocation = Get-AppIconPath -ResolvedInstallPath $ResolvedInstallPath

  if ($CreateDesktop -and [bool]$Selection.webapp) {
    New-Shortcut -ShortcutPath $desktopShortcut -TargetPath (Join-Path $ResolvedInstallPath "Start-CourseForge.cmd") -WorkingDirectory $ResolvedInstallPath -IconLocation $iconLocation
    Write-InstallerLog "Created desktop shortcut: $desktopShortcut"
  }
  elseif (Test-Path $desktopShortcut) {
    Remove-Item $desktopShortcut -Force -ErrorAction SilentlyContinue
    Write-InstallerLog "Removed desktop shortcut by request."
  }

  if ($CreateStartMenu) {
    Ensure-Directory -Path $startMenuFolder
    if ([bool]$Selection.webapp) {
      New-Shortcut -ShortcutPath (Get-StartMenuAppShortcutPath) -TargetPath (Join-Path $ResolvedInstallPath "Start-CourseForge.cmd") -WorkingDirectory $ResolvedInstallPath -IconLocation $iconLocation
    }
    if ([bool]$Selection.extension) {
      New-Shortcut -ShortcutPath (Join-Path $startMenuFolder "CourseForge Extension.lnk") -TargetPath (Join-Path $ResolvedInstallPath "extension") -WorkingDirectory (Join-Path $ResolvedInstallPath "extension") -IconLocation $iconLocation
    }
    New-Shortcut -ShortcutPath (Join-Path $startMenuFolder "Uninstall CourseForge.lnk") -TargetPath (Join-Path $ResolvedInstallPath "Launch-CourseForge-Uninstaller-GUI.cmd") -WorkingDirectory $ResolvedInstallPath
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

function Get-KnownInstallArtifactNames {
  param([string]$ResolvedInstallPath)

  $artifacts = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($name in @(
    "webapp",
    "extension",
    "node-runtime",
    "AutoUpdate-CourseForge.ps1",
    "Check-For-CourseForge-Updates.cmd",
    "Start-CourseForge.cmd",
    "CourseForge-Start.url",
    "CourseForge.ico",
    "Install-CourseForge-Windows.ps1",
    "Install-CourseForge-Windows.cmd",
    "Uninstall-CourseForge-Windows.cmd",
    "Launch-CourseForge-Uninstaller.cmd",
    "Launch-CourseForge-Uninstaller-GUI.ps1",
    "Launch-CourseForge-Uninstaller-GUI.cmd",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "package-manifest.json",
    $script:InstallerMetadataFileName,
    $script:IntegrityManifestFileName,
    $script:RollingSnapshotFileName
  )) {
    [void]$artifacts.Add($name)
  }

  $manifestPath = Join-Path $ResolvedInstallPath "package-manifest.json"
  if (Test-Path $manifestPath) {
    try {
      $manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
      foreach ($include in @($manifest.includes)) {
        if ([string]::IsNullOrWhiteSpace([string]$include)) {
          continue
        }

        $topLevel = ([string]$include).TrimStart('.', '\', '/').Split('/','\')[0]
        if (-not [string]::IsNullOrWhiteSpace($topLevel)) {
          [void]$artifacts.Add($topLevel)
        }
      }
    }
    catch {
      Write-InstallerLog "Could not parse package manifest for artifact cleanup at ${ResolvedInstallPath}: $($_.Exception.Message)"
    }
  }

  return @($artifacts)
}

function Remove-CourseForgeArtifactsFromPath {
  param([string]$ResolvedInstallPath)

  if ([string]::IsNullOrWhiteSpace($ResolvedInstallPath) -or -not (Test-Path $ResolvedInstallPath)) {
    return
  }

  $artifactNames = Get-KnownInstallArtifactNames -ResolvedInstallPath $ResolvedInstallPath
  foreach ($artifactName in $artifactNames) {
    $target = Join-Path $ResolvedInstallPath $artifactName
    if (-not (Test-Path $target)) {
      continue
    }

    try {
      Remove-Item -Path $target -Recurse -Force -ErrorAction Stop
      Write-InstallerLog "Removed install artifact: $target"
    }
    catch {
      Write-InstallerLog "Failed removing install artifact ${target}: $($_.Exception.Message)"
    }
  }

  foreach ($entry in @(Get-ChildItem -Path $ResolvedInstallPath -Force -ErrorAction SilentlyContinue)) {
    if ($artifactNames -contains $entry.Name) {
      continue
    }

    $looksCourseForgeOwned = (
      $entry.Name -like 'CourseForge*' -or
      $entry.Name -like '*CourseForge*' -or
      $entry.Name -like 'Install-CourseForge*' -or
      $entry.Name -like 'Uninstall-CourseForge*' -or
      $entry.Name -like 'Start-CourseForge*' -or
      $entry.Name -like 'Check-For-CourseForge-Updates*' -or
      $entry.Name -like 'AutoUpdate-CourseForge*'
    )

    if (-not $looksCourseForgeOwned) {
      continue
    }

    try {
      Remove-Item -Path $entry.FullName -Recurse -Force -ErrorAction Stop
      Write-InstallerLog "Removed orphan CourseForge artifact: $($entry.FullName)"
    }
    catch {
      Write-InstallerLog "Failed removing orphan CourseForge artifact $($entry.FullName): $($_.Exception.Message)"
    }
  }

  if ((Test-Path $ResolvedInstallPath) -and ((Get-ChildItem -Path $ResolvedInstallPath -Force | Measure-Object).Count -eq 0)) {
    Remove-Item -Path $ResolvedInstallPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-InstallerLog "Removed empty install directory: $ResolvedInstallPath"
  }
}

function Invoke-PreInstallCleanup {
  param(
    [string]$ResolvedInstallPath,
    [hashtable]$Discovery
  )

  if ($null -eq $Discovery) {
    return
  }

  foreach ($legacyInstall in @($Discovery.legacyInstallations)) {
    Write-InstallerLog "Cleaning legacy install root: $($legacyInstall.path) markers=$($legacyInstall.markers -join ',')"
    Remove-CourseForgeArtifactsFromPath -ResolvedInstallPath ([string]$legacyInstall.path)
  }

  $registry = $Discovery.registryState
  if ($null -ne $registry -and -not [string]::IsNullOrWhiteSpace([string]$registry.InstallPath)) {
    $registryPath = [System.IO.Path]::GetFullPath([string]$registry.InstallPath)
    if ($registryPath -ne $ResolvedInstallPath -or -not (Test-Path $registryPath)) {
      Remove-RegistryState
      Write-InstallerLog "Removed stale registry install map for $registryPath"
    }
  }

  $uninstall = $Discovery.uninstallState
  if ($null -ne $uninstall -and -not [string]::IsNullOrWhiteSpace([string]$uninstall.InstallLocation)) {
    $uninstallPath = [System.IO.Path]::GetFullPath([string]$uninstall.InstallLocation)
    if ($uninstallPath -ne $ResolvedInstallPath -or -not (Test-Path $uninstallPath)) {
      Remove-UninstallRegistration
      Write-InstallerLog "Removed stale uninstall registration for $uninstallPath"
    }
  }

  if ($Discovery.legacyInstallations.Count -gt 0) {
    Remove-Shortcuts
    Write-InstallerLog "Removed shortcuts before rebuilding install state."
  }

  Remove-CourseForgeArtifactsFromPath -ResolvedInstallPath $ResolvedInstallPath
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
  param(
    [string]$RequestedPath,
    [hashtable]$Discovery
  )

  if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
    return [System.IO.Path]::GetFullPath($RequestedPath)
  }

  if ($null -ne $Discovery -and -not [string]::IsNullOrWhiteSpace($Discovery.preferredInstallPath)) {
    return [System.IO.Path]::GetFullPath([string]$Discovery.preferredInstallPath)
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

function Resolve-InstallPathSelection {
  param(
    [string]$CurrentPath,
    [bool]$IsInstalled
  )

  if ($Silent -or $FullAuto -or $Repair -or $Uninstall -or $Modify -or $IsInstalled) {
    return $CurrentPath
  }

  $useDefault = Read-YesNo -Prompt "Use default install location ($CurrentPath)" -DefaultValue $true
  if ($useDefault) {
    return $CurrentPath
  }

  while ($true) {
    $candidate = Read-Host "Enter install path"
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      Write-Host "Please enter a folder path."
      continue
    }

    try {
      return [System.IO.Path]::GetFullPath($candidate)
    }
    catch {
      Write-Host "Invalid path. Please enter a full Windows folder path."
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

  Write-InstallerLog "Resolved component selection for ${Mode}: webapp=$webapp extension=$extension"

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

  $requiredRelative = @("Start-CourseForge.cmd", "Check-For-CourseForge-Updates.cmd", "CourseForge.ico", "package-manifest.json", "README.md", "CHANGELOG.md", "LICENSE", "Uninstall-CourseForge-Windows.cmd")
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
    "Start-CourseForge.ps1",
    "courseforge-serve.js",
    "CourseForge-Start.url",
    "CourseForge.ico",
    "Install-CourseForge-Windows.ps1",
    "Install-CourseForge-Windows.cmd",
    "Uninstall-CourseForge-Windows.cmd",
    "Launch-CourseForge-Uninstaller.cmd",
    "Launch-CourseForge-Uninstaller-GUI.ps1",
    "Launch-CourseForge-Uninstaller-GUI.cmd",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "package-manifest.json"
  )

  $nodeRuntimeSource = Get-BundledNodeRuntimePath -ResolvedInstallPath $SourceRoot
  if (Test-Path $nodeRuntimeSource) {
    $null = robocopy $nodeRuntimeSource (Get-BundledNodeRuntimePath -ResolvedInstallPath $ResolvedInstallPath) /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -gt 7) {
      throw "Failed copying bundled Node runtime with robocopy exit code $LASTEXITCODE"
    }
  }

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
      Write-UninstallRegistration -ResolvedInstallPath ([string]$registry.InstallPath)
      Write-InstallerLog "Rollback restored registry map."
    }
    catch {
      Write-InstallerLog "Rollback failed to restore registry map: $($_.Exception.Message)"
    }
  }

  Set-Shortcuts -ResolvedInstallPath $installPath -Selection $snapshot.components -CreateDesktop ([bool]$snapshot.icons.desktop) -CreateStartMenu ([bool]$snapshot.icons.startMenu)
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

  if ($Icons.startMenu -and $Selection.webapp -and -not (Test-Path (Get-StartMenuAppShortcutPath))) {
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
    [hashtable]$Discovery,
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

  Invoke-PreInstallCleanup -ResolvedInstallPath $ResolvedInstallPath -Discovery $Discovery

  Copy-ComponentFiles -SourceRoot $SourceRoot -ResolvedInstallPath $ResolvedInstallPath -Selection $Selection
  Ensure-NodeDependency -ResolvedInstallPath $ResolvedInstallPath

  if ($Selection.extension) {
    $targetManifest = Join-Path $ResolvedInstallPath "extension\manifest.json"
    $sourceManifest = Join-Path $SourceRoot "extension\manifest.json"
    if ((-not (Test-Path $targetManifest)) -and (Test-Path $sourceManifest)) {
      Copy-Item -Path $sourceManifest -Destination $targetManifest -Force
      Write-InstallerLog "Rebuilt missing extension manifest."
    }
  }

  Set-Shortcuts -ResolvedInstallPath $ResolvedInstallPath -Selection $Selection -CreateDesktop ([bool]$Icons.desktop) -CreateStartMenu ([bool]$Icons.startMenu)
  Write-IntegrityManifest -RootPath $ResolvedInstallPath -Selection $Selection

  Write-InstallerMetadata -ResolvedInstallPath $ResolvedInstallPath -Selection $Selection -Icons $Icons -InstallPathSource "repair" -Mode "repair"
  Write-RegistryState -InstallPath $ResolvedInstallPath -WebappInstalled ([bool]$Selection.webapp) -ExtensionInstalled ([bool]$Selection.extension) -DesktopIconInstalled ([bool]$Icons.desktop) -StartMenuIconInstalled ([bool]$Icons.startMenu) -LastRepairTimestamp (Get-TimestampString)
  Write-UninstallRegistration -ResolvedInstallPath $ResolvedInstallPath

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

  if (-not $removeSelection.webapp -and -not $removeSelection.extension) {
    throw "Uninstall blocked because no installed components were detected."
  }

  if (-not $Silent -and -not $FullAuto) {
    $confirmed = Read-YesNo -Prompt "Are you sure you want to uninstall CourseForge" -DefaultValue $true
    if (-not $confirmed) {
      throw "Uninstall cancelled by user."
    }

    $removeSelection.removeUserData = Read-YesNo -Prompt "Delete all local user data (NOT recommended)" -DefaultValue $false
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
    Remove-UninstallRegistration
    Write-InstallerLog "Removed registry map."

    $metaFiles = @(
      "AutoUpdate-CourseForge.ps1",
      "Check-For-CourseForge-Updates.cmd",
      "Start-CourseForge.cmd",
      "Start-CourseForge.ps1",
      "courseforge-serve.js",
      "CourseForge-Start.url",
      "CourseForge.ico",
      "node-runtime",
      "README.md",
      "CHANGELOG.md",
      "LICENSE",
      "package-manifest.json",
      $script:InstallerMetadataFileName,
      $script:IntegrityManifestFileName,
      $script:RollingSnapshotFileName
    )

    foreach ($meta in $metaFiles) {
      $target = Join-Path $ResolvedInstallPath $meta
      if (Test-Path $target) {
        Remove-Item -Path $target -Recurse -Force -ErrorAction SilentlyContinue
      }
    }

    if ((Test-Path $ResolvedInstallPath) -and ((Get-ChildItem -Path $ResolvedInstallPath -Force | Measure-Object).Count -eq 0)) {
      Remove-Item -Path $ResolvedInstallPath -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  else {
    Write-RegistryState -InstallPath $ResolvedInstallPath -WebappInstalled $remainingWebapp -ExtensionInstalled $remainingExtension -DesktopIconInstalled $false -StartMenuIconInstalled $false -LastRepairTimestamp ""
    Write-UninstallRegistration -ResolvedInstallPath $ResolvedInstallPath
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
  if ($removeSelection.removeUserData -and (Test-Path $script:DataRoot)) {
    $verificationIssues.Add("User data directory still exists.")
  }
  if (-not $remainingWebapp -and -not $remainingExtension -and (Test-Path $script:RegistryPath)) {
    $verificationIssues.Add("Registry map still exists.")
  }

  if ($verificationIssues.Count -gt 0) {
    throw ("Uninstall verification failed: " + ($verificationIssues -join "; "))
  }

  Write-InstallerLog "Uninstall completed successfully."

  if (Test-Path $script:LogsRoot) {
    Remove-Item -Path $script:LogsRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (Test-Path $script:RollbackRoot) {
    Remove-Item -Path $script:RollbackRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  if ((-not $removeSelection.removeUserData) -and (Test-Path $script:DataRoot) -and ((Get-ChildItem -Path $script:DataRoot -Force | Measure-Object).Count -eq 0)) {
    Remove-Item -Path $script:DataRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  if ((Test-Path $script:UserRoot) -and ((Get-ChildItem -Path $script:UserRoot -Force | Measure-Object).Count -eq 0)) {
    Remove-Item -Path $script:UserRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
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
  $requestedInstallPath = $InstallPath
  $sourceMetadataPath = Join-Path $sourceRoot $script:InstallerMetadataFileName
  if ([string]::IsNullOrWhiteSpace($requestedInstallPath) -and (Test-Path $sourceMetadataPath)) {
    $requestedInstallPath = $sourceRoot
    Write-InstallerLog "Using script directory as install root hint: $requestedInstallPath"
  }

  $installDiscovery = Find-ExistingInstallations -RequestedPath $requestedInstallPath
  $resolvedInstallPath = Get-EffectiveInstallPath -RequestedPath $requestedInstallPath -Discovery $installDiscovery
  $detection = Detect-Installation -ResolvedInstallPath $resolvedInstallPath
  if ($installDiscovery.detectedInstallations.Count -gt 0) {
    $detection.isInstalled = $true
  }

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

  $requestedInstallPath = Resolve-InstallPathSelection -CurrentPath $resolvedInstallPath -IsInstalled ([bool]$detection.isInstalled)
  $installDiscovery = Find-ExistingInstallations -RequestedPath $requestedInstallPath
  $resolvedInstallPath = Get-EffectiveInstallPath -RequestedPath $requestedInstallPath -Discovery $installDiscovery
  $detection = Detect-Installation -ResolvedInstallPath $resolvedInstallPath
  if ($installDiscovery.detectedInstallations.Count -gt 0) {
    $detection.isInstalled = $true
  }

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

  $selectionMode = if ($Modify) { "modify" } elseif ($Repair) { "repair" } else { "install" }
  $selection = Resolve-ComponentSelection -DefaultWebapp ([bool]$defaultSelection.webapp) -DefaultExtension ([bool]$defaultSelection.extension) -Mode $selectionMode
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
  $operationMode = if ($Modify) { "modify" } elseif ($FullAuto) { "fullauto" } elseif ($Silent) { "silent" } else { "install" }

  if ($Repair) {
    Invoke-WithRollback -ResolvedInstallPath $resolvedInstallPath -CurrentSelection $defaultSelection -CurrentIcons $icons -Operation {
      Repair-Installation -SourceRoot $sourceRoot -ResolvedInstallPath $resolvedInstallPath -Discovery $installDiscovery -Selection $selection -Icons $icons
    }
  }
  else {
    Invoke-WithRollback -ResolvedInstallPath $resolvedInstallPath -CurrentSelection $defaultSelection -CurrentIcons $icons -Operation {
      Invoke-PreInstallCleanup -ResolvedInstallPath $resolvedInstallPath -Discovery $installDiscovery
      Copy-ComponentFiles -SourceRoot $sourceRoot -ResolvedInstallPath $resolvedInstallPath -Selection $selection
      Ensure-NodeDependency -ResolvedInstallPath $resolvedInstallPath
      Set-Shortcuts -ResolvedInstallPath $resolvedInstallPath -Selection $selection -CreateDesktop ([bool]$icons.desktop) -CreateStartMenu ([bool]$icons.startMenu)
      Write-IntegrityManifest -RootPath $resolvedInstallPath -Selection $selection
      Write-InstallerMetadata -ResolvedInstallPath $resolvedInstallPath -Selection $selection -Icons $icons -InstallPathSource $installPathSource -Mode $operationMode
      Write-RegistryState -InstallPath $resolvedInstallPath -WebappInstalled ([bool]$selection.webapp) -ExtensionInstalled ([bool]$selection.extension) -DesktopIconInstalled ([bool]$icons.desktop) -StartMenuIconInstalled ([bool]$icons.startMenu) -LastRepairTimestamp ""
      Write-UninstallRegistration -ResolvedInstallPath $resolvedInstallPath

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
  $supportCode = New-InstallerSupportCode
  Write-InstallerLog "Fatal installer error [$supportCode]: $($_.Exception.Message)"
  Show-CompletionDialog -Success $false -Body ("We couldn't set up the runtime automatically. Please contact support with this code: " + $supportCode)
  Write-Host ("CourseForge setup failed. Support code: " + $supportCode)
  exit 1
}

