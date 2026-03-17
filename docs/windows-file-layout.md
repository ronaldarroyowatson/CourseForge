# Windows File Layout

This document defines the CourseForge installation and runtime paths used by the unified Windows installer and shared cross-platform packaging documentation.

## Canonical Windows Locations

- Default webapp install path: `%LOCALAPPDATA%\Programs\CourseForge\webapp\`
- Default extension install path: `%LOCALAPPDATA%\Programs\CourseForge\extension\`
- User data path: `%LOCALAPPDATA%\CourseForge\data\`
- Installer/runtime logs path: `%LOCALAPPDATA%\CourseForge\logs\`

The installer can still target a custom path, but the out-of-box default is user-scoped so it works on locked-down Windows machines without requiring elevation.

## Installer Metadata and Integrity Files

The installer writes metadata inside the install root:

- `%LOCALAPPDATA%\Programs\CourseForge\installer-metadata.json`
- `%LOCALAPPDATA%\Programs\CourseForge\installer-integrity.json`

These files are used for modify, repair, uninstall verification, and rollback workflows.

## Start Menu and Desktop Shortcuts

Desktop shortcut:

- `%USERPROFILE%\Desktop\CourseForge.lnk`

Start menu folder:

- `%APPDATA%\Microsoft\Windows\Start Menu\Programs\CourseForge\`

Start menu entries:

- `CourseForge Webapp.lnk`
- `CourseForge Extension Folder.lnk`
- `Uninstall CourseForge.lnk`

## Registry Mapping

Registry root:

- `HKEY_CURRENT_USER\Software\CourseForge`

Values maintained by installer lifecycle:

- `InstallPath` (`REG_SZ`)
- `WebappInstalled` (`REG_DWORD`, 0/1)
- `ExtensionInstalled` (`REG_DWORD`, 0/1)
- `DesktopIconInstalled` (`REG_DWORD`, 0/1)
- `StartMenuIconInstalled` (`REG_DWORD`, 0/1)
- `Version` (`REG_SZ`)
- `LastRepairTimestamp` (`REG_SZ`, UTC ISO-8601)
- `SilentInstallAllowed` (`REG_DWORD`, 0/1)

## Cross-Platform Packaging Note

Release artifacts preserve a stable top-level layout for both portable and Windows packages:

- `webapp/`
- `extension/`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`

Windows packages add lifecycle executables/scripts:

- `Install-CourseForge-Windows.ps1`
- `Install-CourseForge-Windows.cmd`
- `Uninstall-CourseForge-Windows.cmd`
- `installer-integrity.json`

Release artifacts for Windows now include:

- `release/CourseForge-<version>-installer.exe` for one-file interactive installation
- `release/CourseForge-<version>-windows.zip` for advanced/manual deployment and updater payloads
