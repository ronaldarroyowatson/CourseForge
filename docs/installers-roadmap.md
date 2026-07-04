# Installers Roadmap

Installer work starts after the CourseForge skeleton and Otto bootstrap flow are stable.

## Target Platforms

- Windows desktop installer
- macOS application bundle and installer image
- Linux package and portable launcher

## UX Requirements

- macOS must support a drag-to-Applications flow with an application icon, Applications folder target, and directional affordance.
- Windows should default to a one-click or minimal-prompt installer that can lay down CourseForge and its Otto runtime in one pass.
- Linux should offer a minimal-prompt package path with a portable fallback for distributions that do not share one installer format.

## Sequencing

- Stabilize the tracer-bullet Otto bootstrap lifecycle.
- Prove manifest loading, package materialization, update application, restart, and CourseForge shell launch.
- Freeze installer requirements after the bootstrap runtime and UI status reporting are repeatable.