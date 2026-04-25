# DSC Module Copilot Instructions

- Keep DSC optional and plugin-managed.
- Do not assume DSC is installed at startup.
- Minimal settings mode must remain available without DSC plugin.
- Preserve floating-card top-layer behavior when plugin is installed.
- Maintain compatibility with CLI plugin lifecycle commands.
- Ensure uninstall path is idempotent when plugin is already absent.
- Add tests for any lifecycle behavior change.
