# CourseForge Testing And Debug Standards

This document defines the repository-wide standards for tests, smoke fixtures, generated artifacts, debug logging, and CLI debug tooling.

Follow these rules for all new test work and when modifying existing coverage.

## 1. Test Suite Structure

CourseForge test categories are:

- `tests/core` for unit and service-level behavior
- `tests/integration` for cross-surface or end-to-end application flows
- `tests/rules` for Firestore rules and static contract checks
- `tmp-smoke/samples` for canonical smoke-test fixtures only

Generated smoke outputs do not belong in canonical samples. Timestamped smoke artifacts must live only as transient outputs under `tmp-smoke/` and should remain gitignored.

## 2. Required Validation Commands

When changing tests, fixtures, OCR validation, or debug tooling, run:

- `npm run typecheck:all`
- `npm run test:index`
- `npm run test:samples:validate`
- `npm run bugfix:test`

`npm run bugfix:test` is the release-quality gate and now includes:

- full workspace and script typechecking
- test index regeneration
- canonical sample validation
- build
- comprehensive test battery
- gated live cloud OCR smoke test

## 3. Canonical Sample File Naming

Canonical sample files must use:

`<category>__<scenario>__<expected-outcome>.<ext>`

Examples:

- `input__empty-file__expect-error.txt`
- `input__corrupted-json__expect-parse-failure.json`
- `ocr__copyright-page__expect-metadata-success.png`
- `ocr__toc-text-capture__expect-parse-success.png`
- `ocr__toc-spread-view__expect-parse-success.png`

Rules:

- encode the expected outcome in the filename
- prefer one canonical fixture per scenario
- keep one blank-input fixture only
- keep one corrupted-input fixture per distinct corruption mode only
- delete duplicate timestamped or ad hoc fixtures after standardization

## 4. Sample Usage Rules

Every canonical sample must be referenced by at least one checked-in test or validation script.

Use `npm run test:samples:validate` to enforce:

- naming compliance
- required blank/corrupt fixtures
- no unused canonical samples
- no silent references to removed sample names

## 5. Test Assertion Standards

Tests must assert meaningful behavior, not only successful execution.

For parser, extraction, and smoke tests, define explicit expectations for:

- required fields
- unexpected fields
- derived values
- confidence or metadata annotations
- error codes or failure reasons
- false positive and false negative cases where applicable

Failures should surface expected-versus-actual differences in a structured way. If a harness only checks truthiness or presence, improve it before adding more cases.

## 6. Smoke Test Standards

Smoke tests must distinguish between:

- canonical fixtures in `tmp-smoke/samples`
- generated output reports in `tmp-smoke/`

Smoke scripts should:

- report missing fields explicitly
- report unexpected fields explicitly
- fail on incomplete required captures
- retain machine-readable reports for the current run only
- avoid proliferating committed timestamped outputs

## 7. Debug Logging Standards

Debug logging must be deterministic and structured.

Every debug log entry should include, when available:

- timestamp
- subsystem
- severity
- source type
- source kind or origin
- message
- error context
- stack trace

Local debug logs should:

- use a predictable path
- enforce size caps
- rotate before runaway growth
- remain local until user-directed sync or upload
- delete after sync only with explicit approval

## 8. CLI Debug Mirror Standards

All major debug workflows should remain available from the CLI through:

- `npm run program -- debug <feature>`
- `npm run program -- debug dump-log`
- `npm run program -- debug clear-log`
- `npm run program -- debug enable`
- `npm run program -- debug disable`

`dump-log` must support source filtering so contributors can inspect:

- `automatic`
- `manual`

When extending debug functionality in the live app, add or update a CLI-equivalent command path.

## 9. Source Type Standard

For new capture and ingestion work, use the normalized source type vocabulary:

- `automatic`
- `manual`

If application entities still use historical values such as `auto`, keep compatibility where needed, but new debug and CLI standards should speak in the normalized `automatic` and `manual` terms.

Tests touching capture or debug metadata should validate source typing explicitly.

## 10. Contributor Checklist

Before merging test or debug changes, confirm:

- redundant fixtures were removed
- canonical fixture names describe scenario and expected outcome
- no tests reference deleted fixtures
- no canonical sample is unused
- test index was regenerated
- bugfix workflow passes without Problems pane errors

## 11. Cache Telemetry Standards

Cache behavior is a first-class debug target. Every debug-enabled run must emit cache telemetry before extraction starts and include a final cache map snapshot at run completion.

Required cache telemetry coverage:

- cache detection by layer: local storage, session storage, IndexedDB, in-memory, temporary cache storage, persisted metadata, cached OCR, cached second-agent, cached TOC, cached upload state, UI state, token/session state
- cache identifiers: keys, database names, cache names, or stable IDs
- cache timestamps when available
- cache decision outcomes: `used`, `ignored`, `stale`, `regenerated`, `cleared`, `failed-clear`
- cache regression records that explain stale-source cause and output impact (for example stale subject, stale TOC hierarchy, stuck upload state)

When cache clearing runs (startup or manual):

- log every removed cache identifier
- log count summaries by layer
- log clear failures (locked/corrupted/inaccessible) as `failed-clear`
- log fallback behavior when forced cleanup is required

Testing requirements for cache telemetry:

- unit tests must assert stale detection and regression capture for metadata and TOC
- unit tests must assert stuck upload cache detection and clear-path telemetry
- unit tests must assert failed-clear telemetry paths for locked/corrupted cache operations
- integration tests must keep single-instance and upload control coverage to ensure cache conflict actions are traceable
