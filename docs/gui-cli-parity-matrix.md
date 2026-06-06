# GUI to CLI Parity Matrix

This document tracks GUI to CLI parity for CourseForge.

Scope:

- top-level GUI workflows and command parity
- command discovery through `courseforge help`
- known parity gaps that must be closed in follow-up slices

## Command Discovery

Use:

- `npm run program -- help`
- `npm run program -- help --all`
- `npm run program -- help <command>`
- `npm run program -- help <command> --examples`
- `npm run program -- help ocr`

GUI OCR debug actions are mirrored by the `courseforge ocr debug ...` command family and are discoverable through `courseforge help ocr`.

## OCR Permission Lifecycle

Use:

- `npm run program -- permissions audit --json`
- `npm run program -- permissions repair`
- `npm run program -- permissions reset`

Safety behavior:

- `permissions repair` and `permissions reset` are dry-run by default.
- add `--apply` to execute repair/reset actions.

## Parity Matrix (Baseline)

| GUI Cluster | Representative GUI Surfaces | CLI Path | Status | Notes |
|---|---|---|---|---|
| Debug log controls | `SettingsPage` debug card | `courseforge debug enable/disable/dump-log/clear-log` | Parity available | Includes source filters and optional cloud sync marker.
| DSC diagnostics | `SettingsPage` design controls debug | `courseforge debug dsc <enable|disable|report|clear>` | Parity available | Report supports page/card targeting and JSON output.
| Plugin lifecycle | `SettingsPage` plugin controls | `courseforge plugins <status|install|uninstall>` | Parity available | Local plugin state and lifecycle artifacts.
| OCR live diagnostics | OCR debug workflows and live iteration scripts | `courseforge debug ocr-live` + `npm run debug:ocr:live` | Parity available | Uses snapshot-file OCR path for deterministic iteration.
| OCR deep introspection | OCR diagnostics and fallback chain analysis | `courseforge ocr debug <trace|pipeline|crops|garbage|rescans|fallback|confidence|structure|tokens|timings|export>` | Parity available (second sweep baseline) | JSON + HTML export supported via `export --full --json` and `export --html`.
| OCR workflow aliases | OCR runbook operations used during stabilization loops | `courseforge ocr <capture|run|iterate|compare|limits>` | Parity available (rate-limit stabilization baseline) | Aliases wrap existing OCR debug/iterate scripts and standardize command naming for operations teams.
| OCR permission chain | macOS capture/accessibility reinstall flow | `courseforge permissions <audit|repair|reset>` | Parity available (stabilization baseline) | `repair/reset` require `--apply`.
| Smoke gates and CI loop | smoke gate and CI loop workflows | `npm run test:smoke:ocr:cloud:gate`, `npm run ocr:ci:loop` | Parity available | Scripted execution already available.
| Textbook CRUD flows | textbook forms/lists and setup flow | `courseforge textbooks <status|mode|isbn|save|edit>` | Parity baseline available (cycle rollout) | Command IDs now bound from GUI handlers with CLI workflow command receipts.
| Admin user/moderation actions | admin tools pages | `courseforge admin <status|moderation|content|debug-policy|premium|corrections|translations|school|super|users>` | Parity baseline available (cycle rollout) | Moderation/content/debug policy/premium, correction/translation review, school admin, super-admin policy/role controls, and user management actions now emit GUI command IDs and CLI mirror paths.
| Settings manipulation | settings cards beyond debug/plugin controls | `courseforge settings <status|language|accessibility|debug|ocr|plugin|school|auth|updater>` | Parity baseline available (cycle rollout) | Language/accessibility/debug/OCR policy, plugin lifecycle, school affiliation, sign-out, language registry, debug upload, and updater checks are command-bound and CLI mirrored.

## Completion Rules For New Features

For every new GUI capability:

1. Add equivalent CLI command/subcommand.
2. Add `courseforge help` entry and examples.
3. Add or update GUI + CLI tests.
4. Update this parity matrix.

## GUI OCR Debug Action Map

| GUI Action Label | GUI Command ID | CLI Equivalent |
|---|---|---|
| Trace | `courseforge ocr debug trace` | `courseforge ocr debug trace --json` |
| Pipeline | `courseforge ocr debug pipeline` | `courseforge ocr debug pipeline --json` |
| Fallback | `courseforge ocr debug fallback` | `courseforge ocr debug fallback --json` |
| Timings | `courseforge ocr debug timings` | `courseforge ocr debug timings --json` |
| Export JSON | `courseforge ocr debug export` | `courseforge ocr debug export --json --output <path>` |
| Export HTML | `courseforge ocr debug export --html` | `courseforge ocr debug export --html --output <path>` |

Additional OCR operations with CLI-only wrappers:

- `courseforge ocr capture --image-file <path>`
- `courseforge ocr run --image-file <path> [--primary-only] [--wait-for-primary] [--max-crops <n>]`
- `courseforge ocr iterate --image-file <path> [--fast|--wait] [--trace-all]`
- `courseforge ocr compare --fixture toc-page1 [--cer] [--structure]`
- `courseforge ocr limits <probe|refresh|show|test> [--json]`
