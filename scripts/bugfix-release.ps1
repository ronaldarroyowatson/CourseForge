# bugfix-release.ps1
# Automates the full CourseForge bugfix release flow.
#
# Usage:
#   .\scripts\bugfix-release.ps1 -Description "Fix xyz crash on startup"
#   .\scripts\bugfix-release.ps1 -Description "Fix xyz" -DryRun       # tests only, no version bump
#   .\scripts\bugfix-release.ps1 -Description "Fix xyz" -TestOnly      # same as DryRun
#   .\scripts\bugfix-release.ps1 -Description "Fix xyz" -SkipTests     # skip tests (emergency)
#   .\scripts\bugfix-release.ps1 -Description "Fix xyz" -SkipPackage   # skip building zip artifacts
#   .\scripts\bugfix-release.ps1 -Description "Fix xyz" -SkipGitHub    # skip GitHub release creation
#
# Steps performed:
#   1. npm run typecheck          (clears VS Code Problems pane errors)
#   2. npm run build              (verify build compiles)
#   3. npm run test:e2e:comprehensive  (full test battery)
#   4. Bump PATCH version in package.json (e.g. 1.4.10 -> 1.4.11)
#   5. Create docs/releases/<version>.md  (release notes)
#   6. Update CHANGELOG.md
#   7. npm run package:portable + package:windows  (build release zips)
#   8. git add -A, commit, tag, push
#   9. gh release create with zip assets

[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseApprovedVerbs', '', Scope = 'Function', Target = '*', Justification = 'Helper names; suppress stale analyzer warnings.')]
param(
  [Parameter(Mandatory = $false)]
  [string]$Description = "(no description provided)",

  # Skip all tests (emergency releases only)
  [switch]$SkipTests,

  # Build artifacts but do not commit/tag/push or create GitHub release
  [switch]$DryRun,

  # Alias for DryRun — just run tests and show what would happen
  [switch]$TestOnly,

  # Skip building portable and windows zip packages
  [switch]$SkipPackage,

  # Skip creating the GitHub release (still commits and tags)
  [switch]$SkipGitHub
)

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $PSCommandPath
$RepoRoot   = Split-Path -Parent $ScriptDir
$PkgPath    = Join-Path $RepoRoot "package.json"
$ChangelogPath = Join-Path $RepoRoot "CHANGELOG.md"
$ReleaseDir = Join-Path $RepoRoot "release"
$ReleaseNotesDir = Join-Path $RepoRoot "docs\releases"

# ---- Read current version ----
$pkgRaw  = Get-Content $PkgPath -Raw
$pkg     = $pkgRaw | ConvertFrom-Json
$current = $pkg.version

if ($current -notmatch '^\d+\.\d+\.\d+$') {
  Write-Error "Could not parse version '$current' from package.json. Expected MAJOR.MINOR.PATCH."
  exit 1
}

$parts    = $current -split '\.'
$newVersion = "$($parts[0]).$($parts[1]).$([int]$parts[2] + 1)"
$today    = (Get-Date).ToString("yyyy-MM-dd")

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  CourseForge Bugfix Release Automation " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Current : $current" -ForegroundColor Yellow
Write-Host "  New     : $newVersion" -ForegroundColor Green
Write-Host "  Date    : $today"
Write-Host "  Fix     : $Description"
if ($DryRun -or $TestOnly) {
  Write-Host "  Mode    : DRY RUN (no version bump, no publish)" -ForegroundColor Magenta
}
Write-Host ""

# ---- Quality Gate ----
if (-not $SkipTests) {
  Push-Location $RepoRoot

  Write-Host "--- [1/3] Typecheck (VS Code Problems pane) ---" -ForegroundColor Cyan
  npm run typecheck
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Error "TYPECHECK FAILED. Fix all TypeScript errors before releasing."
    Pop-Location; exit 1
  }

  Write-Host ""
  Write-Host "--- [2/3] Build ---" -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) {
    Write-Error "BUILD FAILED."
    Pop-Location; exit 1
  }

  Write-Host ""
  Write-Host "--- [3/3] Full test battery (test:e2e:comprehensive) ---" -ForegroundColor Cyan
  npm run test:e2e:comprehensive
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Error "TESTS FAILED. Fix all failing tests before releasing."
    Pop-Location; exit 1
  }

  Pop-Location
  Write-Host ""
  Write-Host "All quality gates passed." -ForegroundColor Green
} else {
  Write-Host "[WARNING] Tests skipped (-SkipTests). Use only for emergency hotfixes." -ForegroundColor Yellow
}

# ---- Dry run / test-only exit ----
if ($DryRun -or $TestOnly) {
  Write-Host ""
  Write-Host "[DryRun] All checks passed. Would bump $current -> $newVersion. Stopping here." -ForegroundColor Magenta
  exit 0
}

# ---- Bump version in package.json ----
Write-Host ""
Write-Host "--- Bumping version $current -> $newVersion ---" -ForegroundColor Cyan
# Replace only the exact "version": "<current>" line to avoid matching version strings in dependencies
$pkgUpdated = $pkgRaw -replace ('"version": "' + [regex]::Escape($current) + '"'), ('"version": "' + $newVersion + '"')
[System.IO.File]::WriteAllText($PkgPath, $pkgUpdated, (New-Object System.Text.UTF8Encoding $false))

# ---- Create release notes doc ----
Write-Host "--- Creating docs/releases/$newVersion.md ---" -ForegroundColor Cyan
if (-not (Test-Path $ReleaseNotesDir)) {
  New-Item -ItemType Directory -Path $ReleaseNotesDir | Out-Null
}
$releaseNotesPath = Join-Path $ReleaseNotesDir "$newVersion.md"
$notesContent = @"
# CourseForge $newVersion

## Summary

$Description

## Validation

- ``npm run typecheck``
- ``npm run build``
- ``npm run test:e2e:comprehensive``

## Verified

- Released $today
"@
[System.IO.File]::WriteAllText($releaseNotesPath, $notesContent, (New-Object System.Text.UTF8Encoding $false))

# ---- Update CHANGELOG ----
Write-Host "--- Updating CHANGELOG.md ---" -ForegroundColor Cyan
$changelog = Get-Content $ChangelogPath -Raw

$newEntry = @"

## [$newVersion] - $today

### Fixed ($newVersion)

- $Description

"@

# Insert the new entry right after "## [Unreleased]"
if ($changelog -match '## \[Unreleased\]') {
  $changelog = $changelog -replace '(## \[Unreleased\])', "`$1$newEntry"
  [System.IO.File]::WriteAllText($ChangelogPath, $changelog, (New-Object System.Text.UTF8Encoding $false))
} else {
  Write-Host "[WARNING] Could not find '## [Unreleased]' section in CHANGELOG.md. Skipping CHANGELOG update." -ForegroundColor Yellow
}

# ---- Build packages ----
if (-not $SkipPackage) {
  Push-Location $RepoRoot

  Write-Host ""
  Write-Host "--- Building portable package ---" -ForegroundColor Cyan
  npm run package:portable
  if ($LASTEXITCODE -ne 0) { Write-Error "Portable package build failed."; Pop-Location; exit 1 }

  Write-Host ""
  Write-Host "--- Building Windows installer package ---" -ForegroundColor Cyan
  npm run package:windows
  if ($LASTEXITCODE -ne 0) { Write-Error "Windows installer package build failed."; Pop-Location; exit 1 }

  Pop-Location
} else {
  Write-Host "[INFO] Package build skipped (-SkipPackage)." -ForegroundColor Yellow
}

# ---- Git commit, tag, push ----
Write-Host ""
Write-Host "--- Git: commit + tag v$newVersion ---" -ForegroundColor Cyan
Push-Location $RepoRoot

git add -A
git commit -m "fix: release v$newVersion - $Description"
if ($LASTEXITCODE -ne 0) { Write-Error "git commit failed."; Pop-Location; exit 1 }

git tag "v$newVersion"
if ($LASTEXITCODE -ne 0) { Write-Error "git tag failed."; Pop-Location; exit 1 }

git push
if ($LASTEXITCODE -ne 0) { Write-Error "git push failed."; Pop-Location; exit 1 }

git push --tags
if ($LASTEXITCODE -ne 0) { Write-Error "git push --tags failed."; Pop-Location; exit 1 }

Pop-Location
Write-Host "Git sync complete." -ForegroundColor Green

# ---- GitHub release ----
if (-not $SkipGitHub) {
  Write-Host ""
  Write-Host "--- Creating GitHub release v$newVersion ---" -ForegroundColor Cyan

  $portableZip = Join-Path $ReleaseDir "CourseForge-$newVersion-portable.zip"
  $windowsZip  = Join-Path $ReleaseDir "CourseForge-$newVersion-windows.zip"

  $ghArgs = @(
    "release", "create", "v$newVersion",
    "--title", "CourseForge v$newVersion",
    "--notes", $Description
  )

  if (Test-Path $portableZip) {
    $ghArgs += $portableZip
    Write-Host "  Attaching: $portableZip"
  } else {
    Write-Host "[WARNING] Portable zip not found: $portableZip" -ForegroundColor Yellow
  }

  if (Test-Path $windowsZip) {
    $ghArgs += $windowsZip
    Write-Host "  Attaching: $windowsZip"
  } else {
    Write-Host "[WARNING] Windows zip not found: $windowsZip" -ForegroundColor Yellow
  }

  Push-Location $RepoRoot
  & gh @ghArgs
  if ($LASTEXITCODE -ne 0) { Write-Error "GitHub release creation failed. Verify with: gh api repos/ronaldarroyowatson/CourseForge/releases/latest"; Pop-Location; exit 1 }
  Pop-Location

  Write-Host ""
  Write-Host "--- Verifying release is discoverable by auto-updater ---" -ForegroundColor Cyan
  Push-Location $RepoRoot
  $releaseCheck = gh api "repos/ronaldarroyowatson/CourseForge/releases/latest" 2>&1
  if ($releaseCheck -match '"tag_name"') {
    $tagLine = ($releaseCheck | Select-String '"tag_name"').Line
    Write-Host "Auto-updater can find release: $tagLine" -ForegroundColor Green
  } else {
    Write-Host "[WARNING] Could not verify release via GitHub API. Check manually." -ForegroundColor Yellow
  }
  Pop-Location
} else {
  Write-Host "[INFO] GitHub release skipped (-SkipGitHub)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  RELEASE v$newVersion COMPLETE!        " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
