# OCR Live Iteration Log

| Timestamp | Label | Provider | Variant | CER (structured) | CER (raw) | Confidence | Chapters | Sections | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 2026-06-07T03:42:30.000Z | cli-parity-page1-page2-ingestion-check | cloud_openai_vision | original + lower-band | n/a | n/a | 1.000 | 3 | 19/23 | Verified `courseforge ocr run --json` against `tmp-smoke/samples/ocr__toc-text-capture__expect-parse-success.png` and `tmp-smoke/samples/ocr__toc-spread-view__expect-parse-success.png`; page1 and page2/spread produced populated parsed TOC structures and distinct selected variants. |
| 2026-06-05T13:54:45.689Z | iter-01-cloud | cloud_openai_vision | original | n/a | n/a | 1.000 | 2 | 13 | duration=37.3s |
| 2026-06-05T13:54:55.709Z | iter-02-local | local_tesseract | lower-band | n/a | n/a | 1.000 | 3 | 10 | duration=7.5s |
| 2026-06-05T13:55:40.782Z | iter-03-cloud | cloud_openai_vision | original | n/a | n/a | 1.000 | 2 | 13 | duration=41.7s |
| 2026-06-05T13:57:40.690Z | local-baseline | local_tesseract | lower-band | 28.0639 | 107.8153 | 1.000 | 3 | 10 | duration=7.7s |
| 2026-06-05T13:58:20.479Z | cloud-baseline | cloud_openai_vision | original | 26.1101 | 210.3020 | 1.000 | 2 | 13 | duration=38.5s |
| 2026-06-05T13:59:09.264Z | local-toc-only | local_tesseract | original | 28.0639 | 107.8153 | 1.000 | 3 | 10 | duration=6.8s |
| 2026-06-05T14:21:45.804Z | iter-01-cloud | cloud_openai_vision | original | 1.4210 | 339.6092 | 1.000 | 3 | 23 | duration=46.4s |
| 2026-06-05T14:21:56.673Z | iter-02-local | local_tesseract | original | 3.7300 | 143.6945 | 1.000 | 3 | 17 | duration=8.3s |
| 2026-06-05T14:22:52.515Z | iter-03-cloud | cloud_openai_vision | original | 1.4210 | 338.3659 | 1.000 | 3 | 23 | duration=52.4s |
| 2026-06-05T14:23:03.366Z | iter-04-local | local_tesseract | original | 3.7300 | 143.6945 | 1.000 | 3 | 17 | duration=8.3s |
| 2026-06-05T14:23:58.741Z | iter-05-cloud | cloud_openai_vision | original | 1.4210 | 307.4600 | 1.000 | 3 | 23 | duration=51.9s |
| 2026-06-05T14:24:09.509Z | iter-06-local | local_tesseract | original | 3.7300 | 143.6945 | 1.000 | 3 | 17 | duration=8.2s |
| 2026-06-05T14:25:01.205Z | iter-07-cloud | cloud_openai_vision | original | 1.4210 | 307.8153 | 1.000 | 3 | 23 | duration=48.2s |
| 2026-06-05T14:25:12.002Z | iter-08-local | local_tesseract | original | 3.7300 | 143.6945 | 1.000 | 3 | 17 | duration=8.3s |
| 2026-06-05T14:25:58.549Z | iter-09-cloud | cloud_openai_vision | original | 1.4210 | 307.8153 | 1.000 | 3 | 23 | duration=43.2s |
| 2026-06-05T14:26:09.220Z | iter-10-local | local_tesseract | original | 3.7300 | 143.6945 | 1.000 | 3 | 17 | duration=8.3s |
| 2026-06-05T14:26:56.184Z | iter-11-cloud | cloud_openai_vision | original | 1.4210 | 338.7211 | 1.000 | 3 | 23 | duration=43.6s |
| 2026-06-05T14:27:06.973Z | iter-12-local | local_tesseract | original | 3.7300 | 143.6945 | 1.000 | 3 | 17 | duration=8.3s |
| 2026-06-05T16:18:45.000Z | validation-gate-only | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Required suites green: tocPreviewPipeline, textbookAutoExtractionService, autoTextbookFlow, bugfix:test EXIT:0 (cloud smoke skipped due no token env); installed desktop-app live TOC capture still pending manual run. |
| 2026-06-05T16:35:11.637Z | desktop-live-toc-attempt-01 | live-capture | mcgraw-tab | n/a | n/a | n/a | 0 | 0 | Capture path executed from Textbooks -> Auto Setup -> Capture TOC Page, but failed with permission_denied in Google Chrome (`capture_failed`, `ui_capture_toc_no_result`). Retry required after enabling macOS Screen Recording permission for the capture browser/runtime. |
| 2026-06-05T16:56:44.168Z | desktop-live-toc-attempt-02 | live-capture | mcgraw-tab | n/a | n/a | n/a | 0 | 0 | Re-tested after `tccutil reset ScreenCapture` for `com.microsoft.edgemac` and `com.microsoft.VSCode`; capture still returned `permission_denied` immediately (no chooser prompt). Likely requires host app/browser restart + explicit macOS Screen Recording allow. |
| 2026-06-05T16:58:43.500Z | desktop-live-fallback-upload-01 | upload-image | mcgraw-live-screenshot | n/a | n/a | n/a | 0 | 0 | Upload fallback path validated by injecting live screenshot `tmp-smoke/live-captures/mcgraw-live-toc-attempt-2026-06-05.png`; OCR completed via local_tesseract but extracted session-timeout/library chrome text (target step resolved to Cover dialog), not usable TOC structure. |
| 2026-06-05T17:09:26.097Z | desktop-live-toc-attempt-03 | live-capture | mcgraw-tab | n/a | n/a | n/a | 0 | 0 | Post-permission retry still fails with `permission_denied` in the shared runtime (`capture_failed`, `ui_capture_toc_no_result`). Browser/runtime identity for Screen Recording permission is still unresolved in this VS Code-hosted shared tab context. |
| 2026-06-05T17:10:00.000Z | toc-cloud-order-fix-01 | code-fix | toc-rescue-provider-order | n/a | n/a | n/a | n/a | n/a | Updated TOC rescue provider order in `src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx` to `cloud_openai_vision -> cloud_github_models_vision -> local_tesseract` (was local-first). Validated with `npx vitest run tests/integration/autoTextbookFlow.integration.test.tsx` (24/24 pass). |
| 2026-06-05T17:17:56.109Z | desktop-live-toc-attempt-04 | live-capture | mcgraw-tab | n/a | n/a | n/a | 0 | 0 | Retried capture after user reported adding CourseForge + VS Code to Screen Recording and rebooting VS Code, but the runtime still returns `permission_denied` and explicitly names `Google Chrome` in the error. This indicates Chrome itself still needs Screen Recording approval/restart in the host OS. |
| 2026-06-05T17:23:40.334Z | desktop-live-toc-attempt-05 | live-capture | mcgraw-tab | n/a | n/a | n/a | 0 | 0 | Retried after adding Edge to Screen Recording allow-list and confirming cloud-auth Auto session; capture still fails with `permission_denied` and browser=`Google Chrome`. Active capture runtime remains Chrome-specific and still not permitted. |
| 2026-06-05T19:51:13.848Z | iter-01-cloud | cloud_openai_vision | center-lower-band | 6.2167 | 293.6057 | 1.000 | 3 | 22 | duration=51.4s |
| 2026-06-05T19:51:32.460Z | iter-02-local | local_tesseract | original | 5.8615 | 192.7176 | 1.000 | 3 | 15 | duration=17.1s |
| 2026-06-05T19:52:26.641Z | iter-03-cloud | cloud_openai_vision | original | 0.0000 | 255.7726 | 1.000 | 3 | 19 | duration=51.6s |
| 2026-06-05T19:52:45.272Z | iter-04-local | local_tesseract | original | 5.8615 | 192.7176 | 1.000 | 3 | 15 | duration=17.1s |
| 2026-06-05T19:54:39.029Z | iter-01-cloud | cloud_openai_vision | original | 0.0000 | 255.9503 | 1.000 | 3 | 19 | duration=55.0s |
| 2026-06-05T19:54:57.611Z | iter-02-local | local_tesseract | original | 5.8615 | 192.7176 | 1.000 | 3 | 15 | duration=17.0s |
| 2026-06-05T19:55:43.104Z | iter-03-cloud | cloud_openai_vision | original | 0.0000 | 255.7726 | 1.000 | 3 | 19 | duration=42.9s |
| 2026-06-05T19:56:01.529Z | iter-04-local | local_tesseract | original | 5.8615 | 192.7176 | 1.000 | 3 | 15 | duration=17.0s |
| 2026-06-05T19:57:27.344Z | iter-01-cloud | cloud_openai_vision | original | 0.0000 | 255.5950 | 1.000 | 3 | 19 | duration=42.2s |
| 2026-06-05T19:57:45.744Z | iter-02-local | local_tesseract | original | 5.8615 | 192.7176 | 1.000 | 3 | 15 | duration=17.0s |
| 2026-06-05T22:16:51.737Z | iter-01-cloud | cloud_openai_vision | original | 0.0000 | 249.2007 | 1.000 | 3 | 19 | duration=47.1s |
| 2026-06-05T22:17:10.294Z | iter-02-local | local_tesseract | original | 5.8615 | 192.7176 | 1.000 | 3 | 15 | duration=17.1s |
| 2026-06-05T22:17:56.861Z | iter-03-cloud | cloud_openai_vision | original | 0.0000 | 255.7726 | 1.000 | 3 | 19 | duration=44.1s |
| 2026-06-05T22:18:15.371Z | iter-04-local | local_tesseract | original | 5.8615 | 192.7176 | 1.000 | 3 | 15 | duration=17.1s |
| 2026-06-05T22:19:02.703Z | iter-05-cloud | cloud_openai_vision | original | 0.0000 | 249.5560 | 1.000 | 3 | 19 | duration=44.8s |
| 2026-06-05T22:19:21.191Z | iter-06-local | local_tesseract | original | 5.8615 | 192.7176 | 1.000 | 3 | 15 | duration=17.0s |
| 2026-06-05T22:52:47.440Z | iter-01-cloud | cloud_openai_vision | original | 0.0000 | 249.3783 | 1.000 | 3 | 19 | duration=34.8s |
| 2026-06-05T22:53:06.207Z | iter-02-local | local_tesseract | original | 5.8615 | 192.7176 | 1.000 | 3 | 15 | duration=17.2s |
| 2026-06-05T22:53:48.827Z | iter-03-cloud | cloud_openai_vision | original | 0.0000 | 249.2007 | 1.000 | 3 | 19 | duration=40.0s |
| 2026-06-05T22:54:07.461Z | iter-04-local | local_tesseract | original | 5.8615 | 192.7176 | 1.000 | 3 | 15 | duration=17.1s |
