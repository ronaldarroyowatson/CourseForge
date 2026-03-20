# CourseForge Auto-Update Test Guide

## Overview

This guide walks through testing the CourseForge auto-update mechanism using version 1.2.7 (patch release from 1.2.6).

## Prerequisites

- CourseForge 1.2.6 installed (or later version less than 1.2.7)
- GitHub account with push access to `ronaldarroyowatson/CourseForge`
- PowerShell execution enabled on Windows

## Releases Ready for Testing

### v1.2.6 (Base Version)
- Installer: `release/CourseForge-1.2.6-installer.exe`
- Portable: `release/CourseForge-1.2.6-portable.zip`

### v1.2.7 (Update Version - Patch/Bug Fix)
- Installer: `release/CourseForge-1.2.7-installer.exe` ✅ Ready
- Portable: `release/CourseForge-1.2.7-portable.zip` ✅ Ready
- **Change**: Fixed launcher error message to show both log file locations (AppData and Temp fallback)

## Test Procedure

### Step 1: Install v1.2.6 (If Not Already Installed)

```powershell
cd "C:\Users\ronal\Documents\CourseForge\release"
.\CourseForge-1.2.6-installer.exe
```

Follow the installer GUI, accept defaults. Note the installation directory (typically `C:\Users\[User]\AppData\Local\Programs\CourseForge`).

### Step 2: Launch v1.2.6 and Verify

```powershell
# Shortcut or
cd "C:\Users\[User]\AppData\Local\Programs\CourseForge"
.\Start-CourseForge.cmd
```

Check that:
- App opens in browser to `http://localhost:3000`
- Console shows "Launcher initialized. Version=1.2.6"
- Logs exist at `%LOCALAPPDATA%\CourseForge\logs\launcher.log`

### Step 3: Create GitHub Release for v1.2.7

1. Go to https://github.com/ronaldarroyowatson/CourseForge/releases
2. Click **"Create a new release"**
3. Set **Tag name**: `v1.2.7`
4. Set **Release title**: `v1.2.7 - Launcher error message path fix`
5. Set **Description**:
   ```
   **Patch Release - Bug Fix**
   - Fixed launcher error message to display both AppData and Temp fallback log locations
   - Improves diagnostics when launcher encounters errors
   ```
6. Attach asset: Upload `CourseForge-1.2.7-portable.zip` from `release/` folder
7. Click **"Publish release"**

### Step 4: Trigger Auto-Update Check

**Option A: Automatic Check (Background)**
- The launcher checks for updates automatically on startup
- May take 20+ seconds to fetch from GitHub
- Check `%LOCALAPPDATA%\CourseForge\logs\updater.log` for progress

**Option B: Manual Check (Immediate)**

Open PowerShell in the CourseForge installation directory:

```powershell
cd "C:\Users\[User]\AppData\Local\Programs\CourseForge"
.\Check-For-CourseForge-Updates.cmd
```

Expected output:
```
Update available.
```

Watch the console and check logs:
- `updater.log` - Update check details and download progress
- Look for: `"Found newer version: 1.2.7 > 1.2.6"`

### Step 5: Verify Update Staging

After the update check completes, look for staged files:

```powershell
# In installation directory:
dir _pending_update\
dir pending-update.json

# Should exist and contain v1.2.7 files
```

Check the pending-update.json:
```powershell
type pending-update.json
```

Expected content:
```json
{
  "version": "1.2.7",
  "assetName": "CourseForge-1.2.7-portable.zip",
  "stagedAt": "2026-03-20T..."
}
```

### Step 6: Apply Update on Next Launch

Close the v1.2.6 app completely, then relaunch:

```powershell
.\Start-CourseForge.cmd
```

Watch the console for the update application message:
```
[Launcher] Applying staged update from _pending_update/ ...
[Launcher] Staged update applied. Refreshing version from manifest.
[Launcher] Active version after apply: 1.2.7
```

### Step 7: Verify v1.2.7 Running

1. Open launcher.log:
   ```powershell
   type "$env:LOCALAPPDATA\CourseForge\logs\launcher.log"
   ```
   
   Should show:
   ```
   [Launcher] Active version after apply: 1.2.7
   ```

2. Staged directories should be cleaned up:
   ```powershell
   # Should NOT exist:
   dir _pending_update\       # Should fail
   dir pending-update.json    # Should not exist
   ```

3. App should be running normally at `http://localhost:3000`

4. To verify the bug fix works, intentionally trigger an error (e.g., delete `webapp/index.html`), close, and relaunch. The error message should now show both log locations.

## Diagnostic Logs

If auto-update fails, check these logs in order:

1. **`updater.log`** - Update check and download
   - Located: `%LOCALAPPDATA%\CourseForge\logs\updater.log`
   - Watch for: "Found newer version", download progress, parse errors

2. **`launcher.log`** - Staged update apply and startup
   - Located: `%LOCALAPPDATA%\CourseForge\logs\launcher.log`
   - Watch for: "Applying staged update", robocopy status, version refresh

3. **`server-stderr.log`** - Server startup errors
   - Located: `%LOCALAPPDATA%\CourseForge\logs\server-stderr.log`
   - If server fails after update apply

4. **Fallback log location** - If AppData write fails
   - Located: `%TEMP%\CourseForge-launcher\launcher.log`
   - New in v1.2.6+ as fallback

## Versioning Convention

All CourseForge releases now follow **Semantic Versioning (MAJOR.MINOR.PATCH)**:

- **MAJOR** (1.x.x): Breaking changes, major rewrites
- **MINOR** (x.2.x): New features/functions (backward compatible)
- **PATCH** (x.x.7): Bug fixes, improvements (backward compatible)

Examples:
- 1.2.6 → 1.2.7: Patch (bug fix) ✅
- 1.2.7 → 1.3.0: Minor (new feature)
- 1.3.0 → 2.0.0: Major (breaking change)

## Expected Results

| Step | Expected Outcome | Status |
|------|------------------|--------|
| Install 1.2.6 | App launches, version shows 1.2.6 | ⏸️ Pending your test |
| Create GitHub release | Release available at github.com | ⏸️ Pending your test |
| Trigger update check | Update found, downloaded, and staged | ⏸️ Pending your test |
| Relaunch app | Staged update applied, version now 1.2.7 | ⏸️ Pending your test |
| Verify update | App runs normally, logs show successful apply | ⏸️ Pending your test |

## Troubleshooting

### Update not detected
- Check GitHub release is published (not draft)
- Ensure asset is named exactly `CourseForge-1.2.7-portable.zip`
- Check network connectivity: `$env:Path` includes curl or Invoke-WebRequest available
- Check `updater.log` for exact error

### Update fails to download
- Check firestore-Rules allow GitHub API calls
- Check temp disk space: `Get-Volume | Select-Object DriveLetter, SizeRemaining`
- Check `updater.log` for 403/404 errors

### Update fails to stage
- Check installation folder has write permissions
- Check robocopy error code in `launcher.log` (should be ≤7 for success)
- Ensure `_pending_update` folder can be created

### App crashes after update
- Check `server-stderr.log` for Node.js errors
- Check `launcher.log` for robocopy or manifest refresh errors
- Manual rollback: Delete `_pending_update/` and restart

## Next Steps

After successful 1.2.7 test:
1. Document results (success/failure/diagnostics)
2. Plan next update: test a **minor** bump (1.3.0 with new feature)
3. Consider automated e2e test for update flow

