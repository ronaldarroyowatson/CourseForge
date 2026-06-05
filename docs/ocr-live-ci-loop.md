# OCR Live CI Loop (GitHub + Local Install)

This workflow creates a repeatable loop for OCR/text-pipeline iteration with:

1. Focused OCR regression tests
2. Optional live cloud OCR smoke gate
4. Remote GitHub installer matrix validation
5. Local macOS packaged-install live smoke validation
6. Optional live-tab OCR debug report from a saved screenshot
7. One JSON report per run under `tmp-smoke/live-ci-loop/`

## Primary command

```bash
npm run ocr:ci:loop -- --description "TOC OCR live iteration" --ref <branch-or-tag>
```

Default behavior:

1. `npx vitest run tests/integration/autoTextbookFlow.integration.test.tsx`
2. `npx vitest run tests/core/textbookAutoExtractionService.test.ts`
3. `npm run test:smoke:ocr:cloud:gate`
4. `npm run orchestrate:installers:wait -- --description "..." --ref <ref>`
5. `bash scripts/installer/run-macos-packaged-installer-smoke.sh`

If `--live-image-file` is provided, the loop also runs `npm run debug:ocr:live` against that snapshot and stores the machine-readable OCR/CER output in the main report.

## Fast local loop

Use this during rapid parser/capture tuning when you want local feedback only.

```bash
npm run ocr:ci:loop:fast
```

This skips cloud smoke and remote matrix, and reuses the existing local macOS artifact.

## Useful flags

- `--description "..."` sets the CI run description and report annotation.
- `--ref <ref>` picks the branch/tag/SHA for GitHub matrix dispatch.
- `--skip-cloud-smoke` skips cloud OCR gate.
- `--skip-remote` skips GitHub matrix dispatch/wait.
- `--skip-local-live` skips local packaged installer smoke.
- `--reuse-mac-artifact` skips rebuilding the macOS package in local smoke.
- `--with-remote-macos` includes the macOS lane in the remote matrix.
- `--live-image-file <path>` runs the live OCR debug command against a saved tab snapshot.
- `--gold-transcript-file <path>` compares the live OCR text against a gold transcript and records CER.
- `--live-ocr-report <path>` writes the live OCR JSON report to a specific file path.

The live OCR debug runner also supports:

- `--provider-order local_tesseract,cloud_openai_vision,...` to force the OCR provider order.
- `--direct-cloud-provider cloud_openai_vision|cloud_github_models_vision` to call cloud vision APIs directly from the CLI runner (without Firebase callable path).
- `--structured-profile toc-page1` to compare against the page-1 TOC canonical profile transcript.
- `--cer-threshold 0.1` to record the target threshold in the JSON output.
- `--fail-on-cer-threshold` to make the debug runner exit nonzero when CER exceeds the threshold.

## Output and evidence

Every run writes a report:

- `tmp-smoke/live-ci-loop/ocr-live-ci-loop-<timestamp>.json`

Report fields include:

- step-by-step pass/fail status
- command, duration, and exit code per step
- remote workflow run metadata (including URL when available)
- local macOS installer smoke results path and summary
- optional live OCR report path

## Live tab workflow

Use this when you want the installed app to process a real browser snapshot and return structured OCR results:

1. Launch the installed app.
2. Capture the target tab as a PNG or JPEG.
3. Run:

```bash
npm run ocr:ci:loop -- --description "live tab iteration" --ref main --skip-remote --skip-cloud-smoke --live-image-file <snapshot.png> --gold-transcript-file <gold.txt>
```

For direct OCR inspection without the full loop, run:

```bash
npm run debug:ocr:live -- --image-file <snapshot.png> --gold-transcript-file <gold.txt> --provider-order local_tesseract
```

For forced cloud OCR in CLI context, run:

```bash
npm run debug:ocr:live -- --image-file <snapshot.png> --gold-transcript-file <gold.txt> --direct-cloud-provider cloud_openai_vision --structured-profile toc-page1 --cer-threshold 0.1
```

4. Inspect the JSON report under `tmp-smoke/live-ci-loop/` and the OCR report path recorded in the report.

## VS Code task

Run task:

- `ocr: ci loop (gh + local live install)`

This invokes:

```bash
npm run ocr:ci:loop -- --description "TOC OCR live iteration" --ref main
```
