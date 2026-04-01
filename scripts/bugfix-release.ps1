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

  # Alias for DryRun â€” just run tests and show what would happen
  [switch]$TestOnly,

  # Skip building portable and windows zip packages
  [switch]$SkipPackage,

  # Skip creating the GitHub release (still commits and tags)
  [switch]$SkipGitHub,

  # Skip only the Firestore rules tests (use when emulator port is occupied by a stale process)
  [switch]$SkipRules
)

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $PSCommandPath
$RepoRoot   = Split-Path -Parent $ScriptDir
$PkgPath    = Join-Path $RepoRoot "package.json"
$ChangelogPath = Join-Path $RepoRoot "CHANGELOG.md"
$ReleaseDir = Join-Path $RepoRoot "release"
$ReleaseNotesDir = Join-Path $RepoRoot "docs\releases"
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
$MainChangelogReleaseCount = 12  # recent releases kept in CHANGELOG.md
$ArchivePageReleaseCount   = 50  # releases per CHANGELOG-page-N.md archive file
$MaxChangelogSizeKB        = 300 # hard ceiling for CHANGELOG.md; older entries overflow to archive pages

function Read-Utf8File {
  param([Parameter(Mandatory = $true)][string]$Path)

  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

function Split-ChangelogContent {
  param([Parameter(Mandatory = $true)][string]$Content)

  $normalized = $Content -replace "`r`n", "`n"
  $headerMarker = "## [Unreleased]"
  $headerIndex = $normalized.IndexOf($headerMarker)
  if ($headerIndex -lt 0) {
    throw "Could not find '## [Unreleased]' section in CHANGELOG.md."
  }

  $header = $normalized.Substring(0, $headerIndex).TrimEnd("`n")
  $sectionsText = $normalized.Substring($headerIndex)
  $matches = [regex]::Matches($sectionsText, '(?ms)^## \[(?<title>[^\]]+)\]\n.*?(?=^## \[|\z)')
  if ($matches.Count -eq 0) {
    throw "Could not parse CHANGELOG.md sections."
  }

  $unreleased = $null
  $releases = New-Object System.Collections.Generic.List[string]
  foreach ($match in $matches) {
    $section = $match.Value.TrimEnd()
    if ($match.Groups['title'].Value -eq 'Unreleased') {
      $unreleased = $section
      continue
    }

    $releases.Add($section)
  }

  if (-not $unreleased) {
    throw "Could not parse the Unreleased section from CHANGELOG.md."
  }

  return [pscustomobject]@{
    Header = $header
    Unreleased = $unreleased
    Releases = @($releases)
  }
}

# Build the CHANGELOG.md body string from parsed parts, given a specific entry count and
# a list of archive page filenames that have already been determined.
function Build-MainChangelogContent {
  param(
    [Parameter(Mandatory = $true)][object]$Parts,
    [Parameter(Mandatory = $true)][int]$KeepCount,
    [string[]]$ArchiveFileNames = @()
  )

  $recentReleases = @($Parts.Releases | Select-Object -First $KeepCount)
  $mainSections   = New-Object System.Collections.Generic.List[string]
  $mainSections.Add($Parts.Header.TrimEnd())     | Out-Null
  $mainSections.Add($Parts.Unreleased.TrimEnd()) | Out-Null

  if ($ArchiveFileNames.Count -gt 0) {
    $archiveLines  = @(
      "### Archive Pages",
      "",
      "Older release entries are continued in the following paged changelog files:",
      ""
    )
    $archiveLines += $ArchiveFileNames | ForEach-Object { "- $_" }
    $mainSections.Add(($archiveLines -join "`n")) | Out-Null
  }

  foreach ($section in $recentReleases) {
    $mainSections.Add($section.TrimEnd()) | Out-Null
  }

  return (($mainSections -join "`n`n").TrimEnd() + "`n") -replace "`n", "`r`n"
}

# Writes CHANGELOG.md (capped to $MaxChangelogSizeKB) and CHANGELOG-page-N.md archive files.
# Starts with $MainChangelogReleaseCount recent entries; if the result would exceed the size
# budget, entries are moved to archive pages two-at-a-time until the budget is met.
function Publish-ChangelogPages {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $parts       = Split-ChangelogContent -Content $Content
  $repoDir     = Split-Path -Parent $Path
  $maxBytes    = $MaxChangelogSizeKB * 1024
  $keepCount   = [Math]::Min($MainChangelogReleaseCount, $parts.Releases.Count)

  while ($true) {
    $archivedReleases      = @($parts.Releases | Select-Object -Skip $keepCount)
    $generatedArchiveNames = New-Object System.Collections.Generic.List[string]

    # Determine archive page names for the current keepCount
    if ($archivedReleases.Count -gt 0) {
      $pageNumber = 1
      for ($i = 0; $i -lt $archivedReleases.Count; $i += $ArchivePageReleaseCount) {
        $generatedArchiveNames.Add("CHANGELOG-page-$pageNumber.md") | Out-Null
        $pageNumber++
      }
    }

    $candidate        = Build-MainChangelogContent -Parts $parts -KeepCount $keepCount -ArchiveFileNames $generatedArchiveNames
    $candidateBytes   = [System.Text.Encoding]::UTF8.GetByteCount($candidate)
    $candidateSizeKB  = [math]::Round($candidateBytes / 1024, 1)

    $withinBudget = ($candidateBytes -le $maxBytes)
    $atMinimum    = ($keepCount -le 1)

    if ($withinBudget -or $atMinimum) {
      if (-not $withinBudget) {
        Write-Host "  [changelog] WARNING: minimum content (1 entry) is still ${candidateSizeKB}KB - exceeds ${MaxChangelogSizeKB}KB limit. Check for oversized release entries." -ForegroundColor Yellow
      }

      # Write archive pages
      $pageNumber = 1
      for ($i = 0; $i -lt $archivedReleases.Count; $i += $ArchivePageReleaseCount) {
        $count      = [Math]::Min($ArchivePageReleaseCount, $archivedReleases.Count - $i)
        $pageEntries = $archivedReleases[$i..($i + $count - 1)]
        $pageName   = "CHANGELOG-page-$pageNumber.md"
        $pagePath   = Join-Path $repoDir $pageName
        $pageContent = @(
          "# Changelog Archive Page $pageNumber",
          "",
          "Older CourseForge release notes continued from CHANGELOG.md.",
          "",
          ($pageEntries -join "`n`n")
        ) -join "`n"
        Write-Utf8File -Path $pagePath -Content $pageContent
        $pageNumber++
      }

      # Remove stale archive pages from previous runs
      Get-ChildItem $repoDir -File -Filter "CHANGELOG-page-*.md" |
        Where-Object { $generatedArchiveNames -notcontains $_.Name } |
        Remove-Item -Force

      Write-Utf8File -Path $Path -Content $candidate

      $archivedCount = $archivedReleases.Count
      $pageCount     = $generatedArchiveNames.Count
      Write-Host "  [changelog] ${candidateSizeKB}KB written - $keepCount recent entries in CHANGELOG.md, $archivedCount older entries in $pageCount archive page(s)." -ForegroundColor Gray
      break
    }

    Write-Host "  [changelog] ${candidateSizeKB}KB with $keepCount entries exceeds ${MaxChangelogSizeKB}KB limit - archiving 2 more entries..." -ForegroundColor Yellow
    $keepCount = [Math]::Max(1, $keepCount - 2)
  }
}

# ---- Read current version ----
$pkgRaw  = Read-Utf8File $PkgPath
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
  if ($SkipRules) {
    Write-Host "[WARNING] Skipping Firestore rules tests (-SkipRules). Ensure rules are unchanged." -ForegroundColor Yellow
    npm run test:e2e:no-rules
  } else {
    npm run test:e2e:comprehensive
  }
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
Write-Utf8File -Path $PkgPath -Content $pkgUpdated

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
Write-Utf8File -Path $releaseNotesPath -Content $notesContent

# ---- Update CHANGELOG ----
Write-Host "--- Updating CHANGELOG.md ---" -ForegroundColor Cyan

# Pre-check: report current on-disk size and warn if already bloated
if (Test-Path $ChangelogPath) {
  $preSizeKB = [math]::Round((Get-Item $ChangelogPath).Length / 1024, 1)
  if ($preSizeKB -gt $MaxChangelogSizeKB) {
    Write-Host "  [changelog] WARNING: CHANGELOG.md is currently ${preSizeKB}KB - exceeds ${MaxChangelogSizeKB}KB limit. Re-paginating now..." -ForegroundColor Yellow
  } elseif ($preSizeKB -gt ($MaxChangelogSizeKB * 0.8)) {
    Write-Host "  [changelog] NOTICE: CHANGELOG.md is ${preSizeKB}KB (>80% of ${MaxChangelogSizeKB}KB limit - pagination may activate after this entry)." -ForegroundColor Yellow
  } else {
    Write-Host "  [changelog] Current size: ${preSizeKB}KB (limit: ${MaxChangelogSizeKB}KB)." -ForegroundColor Gray
  }
}

$changelog = Read-Utf8File $ChangelogPath

$newEntry = @"

## [$newVersion] - $today

### Fixed ($newVersion)

- $Description

"@

# Insert the new entry right after "## [Unreleased]"
if ($changelog -match '## \[Unreleased\]') {
  $changelog = $changelog -replace '(## \[Unreleased\])', "`$1$newEntry"
  Publish-ChangelogPages -Path $ChangelogPath -Content $changelog
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

# ---- Prune old bugfix release folders (keep only current version) ----
Write-Host ""
Write-Host "--- Pruning old release builds (keeping only v$newVersion) ---" -ForegroundColor Cyan
Push-Location $RepoRoot

$oldReleaseFolders = git ls-files "release/" |
  Where-Object { -not $_.Contains($newVersion) }

if ($oldReleaseFolders.Count -gt 0) {
  Write-Host "  Removing $($oldReleaseFolders.Count) old release files from git..."
  $oldReleaseFolders | Set-Content "$RepoRoot\tmp-prune-list.txt"
  git rm --pathspec-from-file="$RepoRoot\tmp-prune-list.txt" -q
  if (Test-Path "$RepoRoot\tmp-prune-list.txt") {
    git rm -q --ignore-unmatch "tmp-prune-list.txt"
    [System.IO.File]::Delete("$RepoRoot\tmp-prune-list.txt")
  }
  # Also clean gitignored files (e.g. updater.log) left in old release dirs
  Get-ChildItem "$RepoRoot\release" -Directory |
    Where-Object { $_.Name -notmatch [regex]::Escape($newVersion) } |
    ForEach-Object { git clean -fdX $_.FullName 2>$null }
  Write-Host "  Old release builds pruned." -ForegroundColor Green
} else {
  Write-Host "  No old release builds to prune." -ForegroundColor Gray
}

Pop-Location

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

  $portableZip    = Join-Path $ReleaseDir "CourseForge-$newVersion-portable.zip"
  $windowsZip     = Join-Path $ReleaseDir "CourseForge-$newVersion-windows.zip"
  $installerExe   = Join-Path $ReleaseDir "CourseForge-$newVersion-installer.exe"

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

  if (Test-Path $installerExe) {
    $ghArgs += $installerExe
    Write-Host "  Attaching: $installerExe"
  } elseif (Test-Path $windowsZip) {
    $ghArgs += $windowsZip
    Write-Host "  Attaching: $windowsZip"
  } else {
    Write-Host "[WARNING] Windows installer not found (neither installer.exe nor windows.zip)" -ForegroundColor Yellow
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
