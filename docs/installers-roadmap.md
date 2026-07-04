# Installers Roadmap

Installer work is now constrained by a strict Otto-first minimalist contract.

## Target Platforms

- Windows desktop installer
- macOS application bundle and installer image
- Linux package and portable launcher

## UX Requirements

- macOS must support a drag-to-Applications flow with an application icon, Applications folder target, and directional affordance.
- Windows should default to a one-click or minimal-prompt installer that can lay down CourseForge and its Otto runtime in one pass.
- Linux should offer a minimal-prompt package path with a portable fallback for distributions that do not share one installer format.

## Universal Otto Pipeline Requirements

- Every Otto-powered app installer must include only boot shell, Otto runtime, payload manifest, telemetry, auth placeholder, splash assets, and base config.
- Otto must always update itself before host application updates.
- Splash and telemetry lifecycle are controlled by Otto, not by host app UI.
- Host app UI must not fully initialize until Otto update sequence and handoff is complete.

## Minimal Installer Exclusions

- No host modules or content packs in installer payload.
- No optional host extensions in installer payload.
- No non-essential Otto extensions in installer payload.
- No CLI/API bundles in installer payload.

## Sequencing

- Stabilize Otto-first startup sequence and self-update behavior.
- Prove telemetry and splash status across update and restart events.
- Prove CourseForge update and auth-card handoff.
- Freeze installer format only after this flow is repeatable on all target platforms.