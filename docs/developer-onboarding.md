# CourseForge – Developer Onboarding Guide

> **Related docs:** [Auto Mode Pipeline](./auto-mode-flowchart.md) · [Firestore Debug Rules](./firestore-debug-rules.md) · [Architecture](./ARCHITECTURE.md) · [Updater Maintainer Guide](./updater-maintainer-guide.md) · [DB Schema](./DB_SCHEMA.md) · [Code Style](./CODE_STYLE.md)

---

## 1. Overview

### 1.1 What is CourseForge?

CourseForge is a **local-first curriculum authoring platform** for teachers. It lets educators build structured textbook hierarchies (textbooks → chapters → sections → vocab, equations, concepts, key ideas) and export them as XML for use in game engines and AI tutors.

All data is written locally first (IndexedDB) and synced to Firebase/Firestore only after passing moderation and policy gates.

---

### 1.2 Auto Mode vs Manual Mode

| | Auto Mode | Manual Mode |
| --- | --- | --- |
| **Entry** | Camera/screenshot capture | Form fields |
| **Metadata source** | OCR text → AI extraction | User-typed |
| **TOC** | Multi-page OCR stitching | User-typed chapter/section list |
| **Confidence** | Per-field confidence dots (high/medium/low) | N/A |
| **Speed** | Fast initial draft, light user editing | Slower, fully controlled |
| **Debug logging** | Full event trail | Minimal |

Auto Mode drives the primary onboarding wizard (`AutoTextbookSetupFlow`). Manual Mode is the fallback when Auto Mode is skipped, cancelled, or produces low-confidence results.

---

### 1.3 Metadata Extraction Pipeline

```text
Capture Image
    │
    ▼
coverImageService  ──▶  image moderation check
    │
    ▼
autoOcrService     ──▶  raw OCR text
    │
    ▼
textbookAutoExtractionService ──▶  scoreMetadataConfidence()
    │                               returns MetadataField<T> per field
    ▼
AutoTextbookSetupFlow UI  ──▶  confidence dots rendered per field
    │
    ▼                         user edits → sourceType: "manual"
autoTextbookPersistenceService ──▶  save to IDB
```

Each metadata field (`title`, `author`, `isbn`, `edition`, `grade`, `subject`, `year`) carries:

- `value` – the extracted or user-edited value  
- `confidence` – 0–1 score  
- `sourceType` – `"auto"` (OCR-derived) or `"manual"` (user-edited)

---

### 1.4 Debug Logging System

The debug logging system captures a local event trail for Auto Mode operations and can upload a compressed report to Firestore on request.

Key characteristics:

- **Primary storage**: IndexedDB (`courseforge-debug` DB, `debugState` object store)  
- **Fallback storage**: `localStorage`  
- **Policy-aware**: fetches `DebugLoggingPolicy` from the `getDebugLoggingPolicy` Cloud Function  
- **Upload throttle**: enforces `maxUploadBytes` (default 512 KB) per report  
- **Per-user disable**: admins can disable logging for specific users via `DebugLoggingPolicy.disabledUserIds`  
- **No-op when disabled**: all `appendDebugLogEntry()` calls are no-ops when the global flag is off or the user is in the disabled list

See `src/core/services/debugLogService.ts` for full API.

---

### 1.5 TOC Stitching Algorithm

When users scan multiple TOC pages, each page produces a `TocPage` (with `pageIndex`, `chapters`, optional `confidence`).

`stitchTocPages(pages: TocPage[]): TocStructure`:

1. Sort pages by `pageIndex`.
2. Normalize chapter and section numbers using `normalizeChapterNumber` / `normalizeSectionNumber`.
3. Merge chapters by normalized number; merge sections by `sectionMergeKey`.
4. Deduplicate using a Map (later entry for same key wins).
5. Sort final chapter/section arrays numerically.
6. Compute `stitchingConfidence` from average page confidence, minus duplicate-count and conflict penalties.

---

### 1.6 Metadata Confidence Scoring

`scoreMetadataConfidence(rawText, metadata)` returns an `AutoMetadataConfidenceMap`.

Each field score is a weighted combination of:

- **OCR signal score** – density, legibility, character quality of the raw string
- **Classifier score** – domain-specific heuristics (e.g., ISBN check digit validation, subject keyword match)
- **Consistency score** – agreement between OCR-extracted value and any user-supplied hint
- **Ambiguity penalty** – deducted when multiple plausible values were found

UI renders as color-coded dots beside each form field:

| Dot color | Confidence | CSS modifier |
| --- | --- | --- |
| Green | ≥ 0.75 | `--high` |
| Yellow | ≥ 0.45 | `--medium` |
| Red | < 0.45 | `--low` |
| Grey | not scored | `--unknown` |

---

## 2. Architecture

### 2.1 Layers

```text
┌──────────────────────────────────────────────────────────┐
│  Frontend                                                 │
│  ├── src/webapp   (React SPA, full editing UI)            │
│  └── src/extension (Browser extension sidebar)           │
├──────────────────────────────────────────────────────────┤
│  Core Services  (src/core/services)                       │
│  ├── textbookAutoExtractionService                        │
│  ├── autoOcrService                                       │
│  ├── autoCaptureService                                   │
│  ├── debugLogService                                      │
│  ├── autoTextbookConflictService                          │
│  ├── autoTextbookPersistenceService                       │
│  └── adminFirestoreService                               │
├──────────────────────────────────────────────────────────┤
│  Repositories  (src/core/services/repositories)           │
│  ├── textbookRepository                                   │
│  ├── chapterRepository                                    │
│  └── sectionRepository                                    │
├──────────────────────────────────────────────────────────┤
│  Local Storage                                            │
│  └── IndexedDB  (IDB via `idb` library)                   │
│      ├── main DB   – textbooks, chapters, sections, …     │
│      └── courseforge-debug  – debug log singleton         │
├──────────────────────────────────────────────────────────┤
│  Firebase                                                 │
│  ├── Firestore  – cloud mirror, user profiles, config     │
│  └── Cloud Functions (v2, onCall)                         │
│      ├── getDebugLoggingPolicy / setDebugLoggingPolicy    │
│      ├── uploadDebugLogReport / listRecentDebugUploads    │
│      ├── setUserAdminStatus                               │
│      └── … (moderation, sync-block, etc.)                 │
└──────────────────────────────────────────────────────────┘
```

### 2.2 Firestore Structure (relevant collections)

```text
/users/{uid}
/textbooks/{textbookId}
    /chapters/{chapterId}
        /sections/{sectionId}
            /vocab/{vocabId}
            /equations/{equationId}
            /concepts/{conceptId}
            /keyIdeas/{keyIdeaId}
/config/debugLoggingPolicy          ← admin-managed global policy
/debugReports/{userId}
    /reports/{reportId}             ← user-uploaded debug logs (write via CF only)
```

### 2.3 Local Debug Log Storage

```text
IndexedDB: courseforge-debug (v1)
  objectStore: debugState
    key: "singleton"
    value: {
      entries: DebugLogEntry[],
      totalBytes: number,
      lastUploadTimestamp?: number
    }
```

Fallback: when IDB is unavailable, the same shape is serialized to `localStorage["courseforge.debugLog"]`.

### 2.4 Cloud Debug Log Upload Path

```text
client: uploadAndClearDebugLogs(userId)
    │
    ├── fetch policy from getDebugLoggingPolicy CF
    ├── enforce maxUploadBytes
    ├── call uploadDebugLogReport CF  (authenticated, userId must match auth.uid)
    │       │
    │       └── Cloud Function writes to /debugReports/{userId}/reports/{timestamp}
    │
    └── clear local IDB entries on success
```

---

## 3. Key Modules

### 3.1 `autoCaptureService`

**Location:** `src/core/services/autoCaptureService.ts`

Handles image acquisition from the browser tab or file system. Responsible for:

- Tab screenshot capture (extension context)
- File/drag-drop capture (webapp context)
- Auto-crop of textbook covers, copyright pages, and TOC pages
- Returns a `CaptureResult` with `imageDataUrl`, dimensions, and `dpi` estimate

### 3.2 `ocrExtractionService` / `autoOcrService`

**Location:** `src/core/services/autoOcrService.ts`

Runs OCR on a captured image and returns structured raw text. Responsible for:

- Submitting image data to the configured OCR provider
- Normalizing the response to a flat text string
- Emitting `ocr_success` / `ocr_failure` debug events

### 3.3 `tocStitchService` (within `textbookAutoExtractionService`)

**Location:** `src/core/services/textbookAutoExtractionService.ts` — `stitchTocPages()`

Takes an ordered array of `TocPage` results (one per scan) and merges them into a single `TocStructure`. See §1.5 above for algorithm detail.

**Key types:**

```ts
interface TocPage {
  pageIndex: number;
  chapters: AutoTocChapter[];
  confidence?: number;
}

interface TocStructure {
  chapters: AutoTocChapter[];
  stitchingConfidence: number;
}
```

### 3.4 `metadataConfidenceService` (within `textbookAutoExtractionService`)

**Location:** `src/core/services/textbookAutoExtractionService.ts` — `scoreMetadataConfidence()`

Scores each metadata field independently and returns an `AutoMetadataConfidenceMap`. See §1.6 above.

### 3.5 `debugLogService`

**Location:** `src/core/services/debugLogService.ts`

Public API:

| Function | Description |
| --- | --- |
| `isDebugLoggingEnabled()` | Sync check against local IDB/localStorage flag |
| `setDebugLoggingEnabled(enabled)` | Toggle local flag |
| `appendDebugLogEntry(entry)` | Async; no-op when disabled or policy blocks |
| `getDebugLogEntries()` | Returns all local entries |
| `clearDebugLogEntries()` | Clears local storage |
| `uploadAndClearDebugLogs(userId)` | Upload then clear |
| `getDebugLogStorageStats()` | Async stats: entries, bytes, maxBytes, lastUpload |

**`DebugEventType` values:**
`auto_capture_start`, `auto_capture_complete`, `auto_crop_success`, `auto_crop_failure`, `ocr_success`, `ocr_failure`, `metadata_extracted`, `toc_extracted`, `toc_stitch`, `user_action`, `error`, `warning`, `info`

### 3.6 `settingsService`

**Location:** `src/core/services/settingsService.ts`

Handles user preferences: theme, AI materials opt-out, debug logging enable/disable. Bridges between in-memory state and IDB persistence.

### 3.7 `firestoreRepository` / Repositories

**Location:** `src/core/services/repositories/`

Pattern: each entity (textbook, chapter, section) has a dedicated repository file exposing async CRUD primitives. Repositories are consumed through the `useRepositories()` React hook, which wraps calls with `markLocalChange()` for sync tracking.

```ts
// Example repository usage via hook
const { addTextbook, editChapter, removeSection } = useRepositories();
```

---

## 4. Development Setup

### 4.1 Prerequisites

- **Node.js `>=20 <25`** for the root workspace (webapp / extension tooling)
- **Node.js `20`** strictly for Firebase Functions (`functions/`)
- **npm** (no Yarn/pnpm)
- A Firebase project with values matching `src/firebase/firebaseConfig.ts`

### 4.2 Install Dependencies

```bash
# Root workspace (webapp + extension)
npm install

# Cloud Functions
cd functions
npm install
cd ..
```

### 4.3 Run the Webapp

```bash
npm run dev
```

Opens a Vite dev server. The webapp is served at `http://localhost:5173` by default.

### 4.4 Run the Extension

```bash
npm run dev:extension
```

Produces an unpacked extension build. Load the `dist-extension/` folder in Chrome via `chrome://extensions → Load unpacked`.

### 4.5 Run Tests

```bash
# All unit + integration tests
npm test

# Specific test file
npx vitest run tests/core/debugLogService.test.ts

# Firestore rules tests (requires emulator)
npm run test:rules

# TypeScript typecheck only
npm run typecheck

# Node runtime checks
npm run check:node
npm run check:node:functions
```

### 4.6 Enable Debug Logging During Development

1. Open the webapp and navigate to **Settings**.
2. Toggle **"Enable debug logging"** on.
3. Run through an Auto Mode flow.
4. Return to **Settings → Debug Logs** to view entries or trigger an upload.

Alternatively, force-enable via the browser console:

```js
// Uses the same IDB key as the settings toggle
localStorage.setItem("courseforge.debugLog.enabled", "true");
```

To inspect raw IndexedDB entries:

1. Open DevTools → Application → IndexedDB → `courseforge-debug` → `debugState`.

---

## 5. Coding Standards

See [CODE_STYLE.md](./CODE_STYLE.md) for the full guide. Key points:

### 5.1 TypeScript Conventions

- Strict mode is enabled (`tsconfig.json`).
- Prefer `interface` for shapes that will be extended; `type` for unions and mapped types.
- Use explicit return types on all exported functions.
- Avoid `any`; use `unknown` + type narrowing where the type is truly dynamic.

### 5.2 Component Structure

```text
src/webapp/components/
  ├── textbooks/
  │   └── AutoTextbookSetupFlow.tsx   ← wizard pages
  ├── admin/
  │   ├── AdminToolsPage.tsx
  │   └── DebugLoggingPanel.tsx
  └── settings/
      └── SettingsPage.tsx
```

- One component per file.
- Props interfaces placed at the top of the file.
- `testingSeedState` prop pattern used for integration test seeding — do not use for production logic.

### 5.3 Service Patterns

- Services are plain TypeScript modules (no classes).
- Side effects (IDB writes, network calls) are isolated in service modules; components call services via hooks or direct imports.
- Barrel exports from `src/core/services/index.ts` — add new service exports there.

### 5.4 Error Handling Expectations

- Cloud Function calls are wrapped in `try/catch`; failures are surfaced as user-visible error messages, never swallowed silently.
- Repository operations log to `console.error` and re-throw so calling code can handle gracefully.
- Debug log failures must never propagate to the user — `appendDebugLogEntry` catches internally.

### 5.5 Logging Expectations

- Use `appendDebugLogEntry` for Auto Mode telemetry — never `console.log` in production paths.
- Use `console.warn` / `console.error` for developer-visible issues during development only.
- Never log PII (email, display name, raw OCR text in full) to debug entries — truncate or omit.

---

## 6. Testing Strategy

### 6.1 Unit Tests

Located in `tests/core/`. Cover:

- Pure algorithmic functions (`stitchTocPages`, `scoreMetadataConfidence`, ISBN validation, etc.)
- Service layer functions with IDB mocked via `vi.mock`
- Repository CRUD operations

Run with `npx vitest run tests/core/`.

### 6.2 Integration Tests

Located in `tests/integration/`. Cover:

- Full Auto Mode wizard flow using `testingSeedState`
- Confidence dot rendering at each confidence tier
- Conflict resolution UI (duplicate ISBN detection and merge/overwrite flow)
- Admin route access and claim refresh

Run with `npx vitest run tests/integration/`.

### 6.3 Mocking OCR and AI Calls

OCR and AI services are mocked using Vitest's `vi.mock`:

```ts
vi.mock("../../../src/core/services/autoOcrService", () => ({
  runOcr: vi.fn().mockResolvedValue({ text: "Mocked OCR text" }),
}));
```

For Auto Mode integration tests, use the `testingSeedState` prop to bypass capture entirely and inject pre-built metadata/TOC state:

```tsx
<AutoTextbookSetupFlow
  testingSeedState={{
    step: "toc-editor",
    tocResult: mockTocStructure,
    metadataConfidence: mockConfidenceMap,
    bypassImageModeration: true,
  }}
/>
```

### 6.4 Testing Auto Mode Flows

Integration test pattern for a full Auto Mode save:

1. Render `AutoTextbookSetupFlow` with `testingSeedState` set to the `"toc-editor"` step.
2. Fill any required form fields.
3. Click **Save** and assert the expected IDB writes via a mocked repository.
4. Assert debug log events were emitted in the expected sequence.

### 6.5 Testing Firestore Rules Locally

Rules tests use `@firebase/rules-unit-testing` and the Firebase Emulator Suite.

```bash
# Start the emulator (requires firebase-tools)
firebase emulators:start --only firestore

# In another terminal, run rule tests
npm run test:rules
```

Rule test files live in `tests/rules/`. Each file:

1. Initializes a test environment with `initializeTestEnvironment`.
2. Creates authenticated and unauthenticated contexts.
3. Asserts `allow` and `deny` outcomes using `assertSucceeds` / `assertFails`.

See [firestore-debug-rules.md](./firestore-debug-rules.md) for debug-specific rule testing guidance.
