# 📦 CourseForge Installers

Download the latest installers for your operating system:

### macOS Installer (.dmg)
👉 https://github.com/ronaldarroyowatson/CourseForge/releases/latest/download/CourseForge-macOS.dmg

### Windows Installer (.exe)
👉 https://github.com/ronaldarroyowatson/CourseForge/releases/latest/download/CourseForge-Windows.exe

### Linux Installer (.AppImage)
👉 https://github.com/ronaldarroyowatson/CourseForge/releases/latest/download/CourseForge-Linux.AppImage

These installers are automatically built and published by GitHub Actions whenever a new version of CourseForge is released.

# CourseForge Boot And Installer Architecture

CourseForge follows a universal Otto-powered bootstrap model:

- Minimal installer footprint
- Otto-first startup orchestration
- Otto self-update before host update
- Splash and telemetry controlled by Otto
- Auth card shown only after update handoff

This pattern is intended to be reused by all Otto-powered applications.

## Minimal Installer Contract

Included in installer:

- CourseForge.exe bootloader
- Otto core runtime
- Otto payload manifest
- Telemetry extension
- Auth extension placeholder
- Splash assets
- Basic configuration files

Not included in installer:

- Host modules
- Host extensions
- Additional Otto extensions
- CLI and API bundles
- Content packs
- Full CourseForge UI beyond onboarding shell

## Otto-First Boot Sequence

1. CourseForge.exe launches bootloader.
2. Bootloader launches Otto.
3. Otto initializes telemetry.
4. Otto initializes splash.
5. Otto loads Otto payload manifest.
6. Otto updates Otto components.
7. Otto restarts if update required.
8. Otto reinitializes telemetry and splash.
9. Otto updates CourseForge components.
10. Otto prepares modules and extensions.
11. Otto hands control to CourseForge auth UI.

## Splash Requirements

The splash is Otto-owned and reports progress from structured telemetry:

- Updating Otto...
- Restarting Otto...
- Updating CourseForge...
- Preparing modules...
- Preparing extensions...

## Telemetry Requirements

Telemetry is structured JSON and is written to local runtime logs. Cloud forwarding is optional and controlled by config.

Telemetry events include:

- Download progress
- Install progress
- Update progress
- Restart events
- Errors
- Command execution events
- Module load events
- Extension load events

## CourseForge Handoff

After Otto finishes update phases, CourseForge renders the CourseForge Cloud onboarding shell.

Onboarding flow:

- Splash screen with continue action
- Auth screen with Google and Email actions
- Workspace screen with clear teacher actions

Teacher safety and ownership safeguards:

- Require cover image upload for new textbook records
- Compute and store cover hash for ownership verification
- Share only teacher-created content and structural metadata

## Key Entry Points

- src/main.ts starts the Electron shell, launches Otto-first bootstrap, and opens the CourseForge handoff window.
- src/bootstrap/otto-bootstrap.ts runs Otto-first update pipeline.
- src/bootstrap/courseforge-bootstrap.ts validates Otto readiness and renders CourseForge Cloud UI.
- courseforge-ui/services/render-courseforge-ui.tsx renders Splash, Auth, and Workspace onboarding screens.

## Scripts

- npm run start builds and launches the Electron app locally.
- npm run build compiles the Electron main process and bootstrap code.
- npm run build:win builds the Windows installer with electron-builder.
- npm run build:mac builds the macOS installers with electron-builder.
- npm run build:linux builds the Linux installer with electron-builder.
- npm test runs vitest suite.

GitHub Actions can run the same installer scripts on push tags or manual dispatch and upload the packaged artifacts from the release folder.

## Runtime Output

- Runtime artifacts are written under .courseforge-runtime/.
- Telemetry boot log is emitted as JSONL under .courseforge-runtime/otto/telemetry/boot-events.jsonl.