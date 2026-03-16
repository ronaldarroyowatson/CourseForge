# Windows File Layout

This document defines the CourseForge installation and runtime paths used by the unified Windows installer and shared cross-platform packaging documentation.

## Canonical Windows Locations

- Webapp install path: `C:\Program Files\CourseForge\webapp\`
- Extension install path: `C:\Program Files\CourseForge\extension\`
- User data path: `%LOCALAPPDATA%\CourseForge\data\`
- Installer/runtime logs path: `%LOCALAPPDATA%\CourseForge\logs\`

## Installer Metadata and Integrity Files

The installer writes metadata inside the install root:

- `C:\Program Files\CourseForge\installer-metadata.json`
- `C:\Program Files\CourseForge\installer-integrity.json`

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

- `HKEY_LOCAL_MACHINE\Software\CourseForge`

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
