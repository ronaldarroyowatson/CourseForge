# Repository Overview (Step 1)

Assumptions:

- Folders like [dist/](dist/), [node_modules/](node_modules/), [tmp-smoke/](tmp-smoke/), and [tmp-installer-extract/](tmp-installer-extract/) are primarily build/runtime/test artifacts rather than long-term source-of-truth code.
- [functions/](functions/) is a separate Firebase Functions package with its own TS build lifecycle.

## Tree (2–3 levels deep)

```text
CourseForge/
├─ .github/
├─ docs/
│  ├─ releases/
│  ├─ ARCHITECTURE.md
│  ├─ PRD.md
│  ├─ DB_SCHEMA.md
│  └─ TESTING_AND_DEBUG_STANDARDS.md
├─ functions/
│  ├─ src/
│  ├─ lib/
│  └─ package.json
├─ locales/
│  ├─ en/
│  ├─ es/
│  ├─ fr/
│  ├─ de/
│  ├─ pt/
│  └─ zm/
├─ scripts/
│  ├─ installer/
│  ├─ bugfix-release.ps1
│  ├─ program-cli.mjs
│  └─ validate-test-samples.mjs
├─ src/
│  ├─ core/
│  │  ├─ models/
│  │  ├─ services/
│  │  └─ xml/
│  ├─ webapp/
│  │  ├─ components/
│  │  ├─ hooks/
│  │  ├─ store/
│  │  └─ utils/
│  ├─ extension/
│  │  ├─ components/
│  │  ├─ hooks/
│  │  └─ manifest.json
│  ├─ firebase/
│  ├─ services/
│  ├─ assets/
│  └─ types/
├─ tests/
│  ├─ core/
│  ├─ integration/
│  └─ rules/
├─ release/
├─ tmp-smoke/
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ vitest.config.ts
└─ firebase.json
```

### Major Directory Purposes

- [src/](src/): Main application source, split into domain/core logic, web app UI, browser extension UI/runtime, Firebase client wiring, and shared app services/types.
- [src/core/](src/core/): Core business logic and data transformation layers (models, service logic, XML pipeline support).
- [src/webapp/](src/webapp/): Primary React web interface including app entry, UI components, hooks, state store, styling, and utility helpers.
- [src/extension/](src/extension/): Browser extension implementation (manifest, background runtime, React sidebar/front-end surface).
- [src/firebase/](src/firebase/): Firebase initialization and service adapters (auth, Firestore, storage, callable functions).
- [src/services/](src/services/): Cross-surface service facades (including sync and Azure sync integration entry points).
- [functions/](functions/): Cloud Functions codebase with isolated dependencies/build output for backend callable/trigger logic.
- [tests/](tests/): Automated test suites across unit/core behaviors, integration workflows, and Firestore rules validation.
- [scripts/](scripts/): Operational automation scripts for release, packaging, smoke checks, test indexing, and CLI program pathways.
- [docs/](docs/): Architecture, product, testing standards, schema references, and release notes documentation.
- [locales/](locales/): Language resource packs for localization/internationalization across supported languages.
- [release/](release/): Built distributable artifacts (portable/windows packages by version).
- [tmp-smoke/](tmp-smoke/): Smoke-test scripts and generated diagnostic outputs.
- [tmp-installer-extract/](tmp-installer-extract/): Temporary installer extraction workspace used during packaging/validation flows.
- [dist/](dist/): Compiled/bundled output from build steps.
- [.github/](.github/): Repository automation and workflow metadata (CI/CD and repo-level GitHub config).

## Domains and Modules

Assumptions:

- Domain boundaries are inferred from current module names, callable exports, and integration tests.
- This section is appended as Step 2 and keeps Step 1 unchanged.

### 1. Curriculum Data Model and Repositories

Primary modules/files:

- [src/core/models/entities.ts](src/core/models/entities.ts)
- [src/core/services/repositories/index.ts](src/core/services/repositories/index.ts)
- [src/core/services/repositories/textbookRepository.ts](src/core/services/repositories/textbookRepository.ts)
- [src/core/services/repositories/chapterRepository.ts](src/core/services/repositories/chapterRepository.ts)
- [src/core/services/repositories/sectionRepository.ts](src/core/services/repositories/sectionRepository.ts)
- [src/core/services/repositories/vocabRepository.ts](src/core/services/repositories/vocabRepository.ts)
- [src/core/services/repositories/equationRepository.ts](src/core/services/repositories/equationRepository.ts)
- [src/core/services/repositories/conceptRepository.ts](src/core/services/repositories/conceptRepository.ts)
- [src/core/services/repositories/keyIdeaRepository.ts](src/core/services/repositories/keyIdeaRepository.ts)

Responsibility summary:

- Defines the canonical entity schema for textbooks, hierarchy nodes, and section-scoped content, including moderation and sync metadata.
- Repository modules provide CRUD and lookup boundaries so UI/hook layers manipulate content through domain-level operations instead of raw storage calls.

Cross-surface interaction:

- Used by both web app and extension hooks; persisted locally first, then synchronized through sync services to Firebase/Functions-managed cloud state.

### 2. Local-First Storage and Sync Orchestration

Primary modules/files:

- [src/core/services/db.ts](src/core/services/db.ts)
- [src/core/services/syncService.ts](src/core/services/syncService.ts)
- [src/services/syncService.ts](src/services/syncService.ts)
- [src/services/azureSyncService.ts](src/services/azureSyncService.ts)
- [src/webapp/hooks/useAutoSync.ts](src/webapp/hooks/useAutoSync.ts)
- [tests/integration/firebase.connection.integration.test.ts](tests/integration/firebase.connection.integration.test.ts)

Responsibility summary:

- Maintains local-first persistence and pending-sync workflows, then reconciles with cloud using guardrails (throttling, retry limits, write/read budgets, loop protection).
- A separate dual-write service coordinates Firebase and Azure sync/reconciliation with queued retries for failed writes.

Cross-surface interaction:

- Web app auto-sync hook drives sync cycles, core sync service performs data movement, Firebase adapters execute transport, and dual-write service fans out to Azure plus Firebase.

### 3. Authentication, Authorization, and User Identity

Primary modules/files:

- [src/firebase/auth.ts](src/firebase/auth.ts)
- [src/webapp/hooks/useAuthBootstrap.ts](src/webapp/hooks/useAuthBootstrap.ts)
- [src/webapp/components/auth/LoginPage.tsx](src/webapp/components/auth/LoginPage.tsx)
- [src/webapp/components/auth/RequireAuth.tsx](src/webapp/components/auth/RequireAuth.tsx)
- [src/webapp/components/auth/RequireAdmin.tsx](src/webapp/components/auth/RequireAdmin.tsx)
- [functions/src/index.ts](functions/src/index.ts)
- [tests/integration/extension.auth.communication.integration.test.ts](tests/integration/extension.auth.communication.integration.test.ts)

Responsibility summary:

- Initializes persistent Firebase auth across browser and extension runtimes, supports Google sign-in, and tracks claim-aware auth state.
- Route guards and backend claim checks enforce authenticated/admin-only behavior; profile metadata is upserted for admin visibility.

Cross-surface interaction:

- Webapp/extension both depend on shared Firebase auth initialization; admin claims are authoritative in cloud functions and consumed by UI guards.

### 4. Admin Governance, Moderation, and Premium Controls

Primary modules/files:

- [src/webapp/components/admin/AdminToolsPage.tsx](src/webapp/components/admin/AdminToolsPage.tsx)
- [src/webapp/components/admin/ModerationQueue.tsx](src/webapp/components/admin/ModerationQueue.tsx)
- [src/webapp/components/admin/UserManagement.tsx](src/webapp/components/admin/UserManagement.tsx)
- [src/webapp/components/admin/PremiumUsagePanel.tsx](src/webapp/components/admin/PremiumUsagePanel.tsx)
- [src/core/services/adminFirestoreService.ts](src/core/services/adminFirestoreService.ts)
- [src/core/services/premiumUsageService.ts](src/core/services/premiumUsageService.ts)
- [functions/src/index.ts](functions/src/index.ts)
- [tests/integration/functions.communication.integration.test.ts](tests/integration/functions.communication.integration.test.ts)

Responsibility summary:

- Implements moderation queues, content status transitions, user role/blocking controls, and premium usage management/reporting.
- Server callables provide protected operations for admin actions and policy enforcement, while admin UI panels expose workflows.

Cross-surface interaction:

- Web admin panels invoke callable functions via Firebase Functions client; results feed core/admin services and back into synced entity state.

### 5. Ingestion, OCR, and Metadata/Content Extraction

Primary modules/files:

- [src/core/services/autoOcrService.ts](src/core/services/autoOcrService.ts)
- [src/core/services/documentIngestService.ts](src/core/services/documentIngestService.ts)
- [src/core/services/metadataExtractionPipelineService.ts](src/core/services/metadataExtractionPipelineService.ts)
- [src/core/services/textbookAutoExtractionService.ts](src/core/services/textbookAutoExtractionService.ts)
- [src/core/services/autoTextbookPersistenceService.ts](src/core/services/autoTextbookPersistenceService.ts)
- [src/core/services/autoTextbookConflictService.ts](src/core/services/autoTextbookConflictService.ts)
- [src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx](src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx)
- [src/webapp/components/content/DocumentIngestPanel.tsx](src/webapp/components/content/DocumentIngestPanel.tsx)
- [functions/src/documentExtraction.ts](functions/src/documentExtraction.ts)
- [functions/src/index.ts](functions/src/index.ts)

Responsibility summary:

- Handles automated textbook/content capture pipelines, ingestion normalization, extraction quality analysis, and conflict-safe persistence into curriculum structures.
- Cloud callables perform heavier extraction and AI-assisted operations, while client services orchestrate user flow and resulting saves.

Cross-surface interaction:

- Web app capture flows trigger core extraction services and backend callables; extracted data is persisted via repositories and later synced through cloud channels.

### 6. Translation, Glossary, and Localization Workflow

Primary modules/files:

- [src/core/services/i18nService.ts](src/core/services/i18nService.ts)
- [src/core/services/glossaryService.ts](src/core/services/glossaryService.ts)
- [src/core/services/translationMemoryCloudService.ts](src/core/services/translationMemoryCloudService.ts)
- [src/core/services/translationWorkflowService.ts](src/core/services/translationWorkflowService.ts)
- [src/core/services/translationReviewService.ts](src/core/services/translationReviewService.ts)
- [src/webapp/components/admin/TranslationMemoryPanel.tsx](src/webapp/components/admin/TranslationMemoryPanel.tsx)
- [src/webapp/components/admin/TranslationReviewPanel.tsx](src/webapp/components/admin/TranslationReviewPanel.tsx)
- [locales/en](locales/en)
- [locales/zm](locales/zm)

Responsibility summary:

- Supports multilingual content workflows through translation memory, glossary enforcement, review queues, and language-aware field handling.
- Couples domain translation entities with administrative review tooling for human-in-the-loop quality control.

Cross-surface interaction:

- Translation services operate in core layer, admin panels supervise quality/review, and locale packs provide UI/runtime language assets across surfaces.

### 7. Content Authoring UX Surfaces (Web App + Extension)

Primary modules/files:

- [src/webapp/main.tsx](src/webapp/main.tsx)
- [src/webapp/App.tsx](src/webapp/App.tsx)
- [src/webapp/components/app/TextbookWorkspace.tsx](src/webapp/components/app/TextbookWorkspace.tsx)
- [src/webapp/components/content/SectionContentPanel.tsx](src/webapp/components/content/SectionContentPanel.tsx)
- [src/webapp/store/uiStore.ts](src/webapp/store/uiStore.ts)
- [src/webapp/store/authStore.ts](src/webapp/store/authStore.ts)
- [src/extension/main.tsx](src/extension/main.tsx)
- [src/extension/SidebarApp.tsx](src/extension/SidebarApp.tsx)
- [src/extension/background.js](src/extension/background.js)
- [src/extension/hooks/useRepositories.ts](src/extension/hooks/useRepositories.ts)
- [tests/integration/extension.repositories.integration.test.ts](tests/integration/extension.repositories.integration.test.ts)

Responsibility summary:

- Web app provides full workspace operations (authoring, settings, admin routing), while extension provides focused quick-capture and export side panel workflows.
- Both surfaces share repository/service contracts so captured data and full authoring edits remain consistent.

Cross-surface interaction:

- Extension quick-add writes through shared repository hooks; web app consumes same domain state and sync pipeline, enabling seamless continuation between surfaces.

### 8. Export and Presentation Transformation

Primary modules/files:

- [src/core/services/xml/exportXml.ts](src/core/services/xml/exportXml.ts)
- [src/core/services/xml/exportData.ts](src/core/services/xml/exportData.ts)
- [src/core/services/xml/formatXml.ts](src/core/services/xml/formatXml.ts)
- [src/core/services/presentationService.ts](src/core/services/presentationService.ts)
- [src/webapp/components/content/PowerPointWorkspaceCard.tsx](src/webapp/components/content/PowerPointWorkspaceCard.tsx)
- [src/extension/components/export/SidebarExportPanel.tsx](src/extension/components/export/SidebarExportPanel.tsx)
- [functions/src/index.ts](functions/src/index.ts)

Responsibility summary:

- Converts authored curriculum data into normalized XML outputs and supports presentation ingestion/conversion workflows for source material.
- Keeps export logic centralized in core services while exposing export actions through both web and extension UX.

Cross-surface interaction:

- Authoring surfaces call shared export services; function endpoints support advanced transformation tasks used by ingest/presentation flows.

---

## Key Flows and Entry Points

Assumption:

- No physical index file exists yet in the repo, so this is the Step 3 section to append immediately after Step 2 in the permanent index stream.

### 1. Webapp Bootstrap Flow

Primary entry point files:

- [src/webapp/main.tsx](src/webapp/main.tsx)
- [src/webapp/App.tsx](src/webapp/App.tsx)
- [src/webapp/hooks/useAuthBootstrap.ts](src/webapp/hooks/useAuthBootstrap.ts)
- [src/webapp/hooks/useAutoSync.ts](src/webapp/hooks/useAutoSync.ts)

Flow summary:

- Startup begins in [src/webapp/main.tsx](src/webapp/main.tsx), which warms the local DB, selects router mode, and registers the service worker in served mode. The root [src/webapp/App.tsx](src/webapp/App.tsx) then initializes auth bootstrap and autosync before rendering guarded routes. Auth restoration and initial user sync are orchestrated in [src/webapp/hooks/useAuthBootstrap.ts](src/webapp/hooks/useAuthBootstrap.ts), while background/interval sync behavior is managed in [src/webapp/hooks/useAutoSync.ts](src/webapp/hooks/useAutoSync.ts). Route-level access control flows through [src/webapp/components/auth/RequireAuth.tsx](src/webapp/components/auth/RequireAuth.tsx) and [src/webapp/components/auth/RequireAdmin.tsx](src/webapp/components/auth/RequireAdmin.tsx).

Major modules involved:

- Auth/session state: [src/firebase/auth.ts](src/firebase/auth.ts), [src/webapp/store/authStore.ts](src/webapp/store/authStore.ts)
- Global UI/sync state: [src/webapp/store/uiStore.ts](src/webapp/store/uiStore.ts)
- Sync core: [src/core/services/syncService.ts](src/core/services/syncService.ts)
- Routing/workspace shell: [src/webapp/components/app/TextbookWorkspace.tsx](src/webapp/components/app/TextbookWorkspace.tsx)

### 2. Extension Bootstrap Flow

Primary entry point files:

- [src/extension/main.tsx](src/extension/main.tsx)
- [src/extension/SidebarApp.tsx](src/extension/SidebarApp.tsx)
- [src/extension/background.js](src/extension/background.js)

Flow summary:

- The extension UI boots through [src/extension/main.tsx](src/extension/main.tsx), applies system theme preference, and mounts the sidebar shell. [src/extension/SidebarApp.tsx](src/extension/SidebarApp.tsx) restores persisted textbook/chapter/section context, drives quick-capture form switching, and exposes export controls in one focused runtime surface. The MV3 worker in [src/extension/background.js](src/extension/background.js) remains intentionally minimal, serving as a lightweight lifecycle anchor for future extension runtime hooks.

Major modules involved:

- Repository bridge: [src/extension/hooks/useRepositories.ts](src/extension/hooks/useRepositories.ts)
- Quick capture forms: [src/extension/components/content/QuickVocabForm.tsx](src/extension/components/content/QuickVocabForm.tsx), [src/extension/components/content/QuickEquationForm.tsx](src/extension/components/content/QuickEquationForm.tsx), [src/extension/components/content/QuickConceptForm.tsx](src/extension/components/content/QuickConceptForm.tsx), [src/extension/components/content/QuickKeyIdeaForm.tsx](src/extension/components/content/QuickKeyIdeaForm.tsx)
- Selection and export UI: [src/extension/components/selectors/TextbookSelector.tsx](src/extension/components/selectors/TextbookSelector.tsx), [src/extension/components/export/SidebarExportPanel.tsx](src/extension/components/export/SidebarExportPanel.tsx)

### 3. Local-First Write and Sync Reconciliation Flow

Primary entry point files:

- [src/core/services/repositories/index.ts](src/core/services/repositories/index.ts)
- [src/core/services/syncService.ts](src/core/services/syncService.ts)
- [src/webapp/hooks/useAutoSync.ts](src/webapp/hooks/useAutoSync.ts)
- [src/services/syncService.ts](src/services/syncService.ts)

Flow summary:

- Authoring writes are persisted locally first via repository/services and flagged for sync, then [src/core/services/syncService.ts](src/core/services/syncService.ts) performs bidirectional merge against cloud data using timestamp conflict resolution, user policy checks, and write/read safety budgets. Runtime invocations of `syncNow` are triggered by bootstrap, interval, online events, and local-change signals from UI state. A secondary dual-write path in [src/services/syncService.ts](src/services/syncService.ts) reconciles Firebase and Azure copies with a local retry queue and periodic flush loop.

Major modules involved:

- Local persistence: [src/core/services/db.ts](src/core/services/db.ts)
- Cloud transport/auth context: [src/firebase/firestore.ts](src/firebase/firestore.ts), [src/firebase/auth.ts](src/firebase/auth.ts)
- Dual-write backend: [src/services/azureSyncService.ts](src/services/azureSyncService.ts)
- Sync observability/guardrails: [src/webapp/store/uiStore.ts](src/webapp/store/uiStore.ts)

### 4. Authentication and Authorization Flow

Primary entry point files:

- [src/firebase/auth.ts](src/firebase/auth.ts)
- [src/webapp/hooks/useAuthBootstrap.ts](src/webapp/hooks/useAuthBootstrap.ts)
- [src/webapp/components/auth/RequireAuth.tsx](src/webapp/components/auth/RequireAuth.tsx)
- [src/webapp/components/auth/RequireAdmin.tsx](src/webapp/components/auth/RequireAdmin.tsx)
- [functions/src/index.ts](functions/src/index.ts)

Flow summary:

- Firebase auth is initialized with persistent browser storage and token-change listeners in [src/firebase/auth.ts](src/firebase/auth.ts), then consumed by the bootstrap hook to restore session state and hydrate claims. UI route guards enforce authenticated/admin access at navigation time, while claim refresh logic keeps admin transitions reactive. Server-side callable handlers in [functions/src/index.ts](functions/src/index.ts) enforce privileged operations through explicit admin assertion, making backend authorization authoritative even if client state is stale.

Major modules involved:

- Session/auth state: [src/webapp/store/authStore.ts](src/webapp/store/authStore.ts)
- Firebase app wiring: [src/firebase/firebaseApp.ts](src/firebase/firebaseApp.ts), [src/firebase/firebaseConfig.ts](src/firebase/firebaseConfig.ts)
- Backend claim enforcement helpers: [functions/src/index.ts](functions/src/index.ts#L510), [functions/src/index.ts](functions/src/index.ts#L514)

### 5. Ingestion, OCR, and Extraction Pipeline Flow

Primary entry point files:

- [src/webapp/components/content/DocumentIngestPanel.tsx](src/webapp/components/content/DocumentIngestPanel.tsx)
- [src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx](src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx)
- [src/core/services/documentIngestService.ts](src/core/services/documentIngestService.ts)
- [functions/src/index.ts](functions/src/index.ts#L3027)
- [functions/src/documentExtraction.ts](functions/src/documentExtraction.ts)

Flow summary:

- Document ingest starts in [src/webapp/components/content/DocumentIngestPanel.tsx](src/webapp/components/content/DocumentIngestPanel.tsx), where files are validated, extracted through service calls, and moved through review/save stages into section content entities. Auto textbook onboarding in [src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx](src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx) coordinates screenshot capture, OCR fallback, metadata confidence/scoring, conflict planning, and persistence. Browser-side orchestration in [src/core/services/documentIngestService.ts](src/core/services/documentIngestService.ts) calls cloud extraction endpoints, while backend handlers run quality analysis and AI-assisted extraction in [functions/src/documentExtraction.ts](functions/src/documentExtraction.ts).

Major modules involved:

- OCR/metadata services: [src/core/services/autoOcrService.ts](src/core/services/autoOcrService.ts), [src/core/services/metadataExtractionPipelineService.ts](src/core/services/metadataExtractionPipelineService.ts), [src/core/services/textbookAutoExtractionService.ts](src/core/services/textbookAutoExtractionService.ts)
- Persistence and correction learning: [src/core/services/autoTextbookPersistenceService.ts](src/core/services/autoTextbookPersistenceService.ts), [src/core/services/metadataCorrectionLearningService.ts](src/core/services/metadataCorrectionLearningService.ts)
- Relevant callable endpoints: [functions/src/index.ts](functions/src/index.ts#L2354), [functions/src/index.ts](functions/src/index.ts#L3027)

### 6. Admin Governance and Moderation Flow

Primary entry point files:

- [src/webapp/components/admin/AdminToolsPage.tsx](src/webapp/components/admin/AdminToolsPage.tsx)
- [src/webapp/components/admin/ModerationQueue.tsx](src/webapp/components/admin/ModerationQueue.tsx)
- [src/core/services/adminFirestoreService.ts](src/core/services/adminFirestoreService.ts)
- [functions/src/index.ts](functions/src/index.ts#L1538)
- [functions/src/index.ts](functions/src/index.ts#L1615)
- [functions/src/index.ts](functions/src/index.ts#L1634)

Flow summary:

- Admin UI tools load in the web workspace and drive moderation, user governance, and usage controls through service-layer calls. Backend callable APIs handle role promotion, queue retrieval, moderation status updates, and premium usage operations under strict admin checks. This keeps moderation decisioning centralized in cloud logic while exposing controlled workflows in the app.

Major modules involved:

- Admin panels: [src/webapp/components/admin/UserManagement.tsx](src/webapp/components/admin/UserManagement.tsx), [src/webapp/components/admin/PremiumUsagePanel.tsx](src/webapp/components/admin/PremiumUsagePanel.tsx), [src/webapp/components/admin/CorrectionReviewPanel.tsx](src/webapp/components/admin/CorrectionReviewPanel.tsx)
- Premium and debug policy services: [src/core/services/premiumUsageService.ts](src/core/services/premiumUsageService.ts), [src/core/services/debugLogService.ts](src/core/services/debugLogService.ts)
- Backend moderation contracts: [functions/src/index.ts](functions/src/index.ts)

### 7. Authoring Workspace Flows (Web and Extension)

Primary entry point files:

- [src/webapp/components/app/TextbookWorkspace.tsx](src/webapp/components/app/TextbookWorkspace.tsx)
- [src/webapp/hooks/useRepositories.ts](src/webapp/hooks/useRepositories.ts)
- [src/extension/SidebarApp.tsx](src/extension/SidebarApp.tsx)
- [src/extension/hooks/useRepositories.ts](src/extension/hooks/useRepositories.ts)

Flow summary:

- The web workspace orchestrates textbook → chapter → section navigation and content-tab workflow progression, then delegates writes through repository hooks that normalize entities and mark pending sync. The extension follows the same hierarchical model, but compresses it into quick-capture actions scoped to the active section. Both surfaces converge on shared repository/service contracts, which is why content created in extension can be immediately managed in webapp flows.

Major modules involved:

- Web content panels: [src/webapp/components/content/SectionContentPanel.tsx](src/webapp/components/content/SectionContentPanel.tsx), [src/webapp/components/chapters/ChapterForm.tsx](src/webapp/components/chapters/ChapterForm.tsx), [src/webapp/components/sections/SectionForm.tsx](src/webapp/components/sections/SectionForm.tsx)
- Shared repositories: [src/core/services/repositories/index.ts](src/core/services/repositories/index.ts)
- Core entity schema: [src/core/models/entities.ts](src/core/models/entities.ts)

### 8. Export and Presentation Flows

Primary entry point files:

- [src/extension/components/export/SidebarExportPanel.tsx](src/extension/components/export/SidebarExportPanel.tsx)
- [src/core/services/xml/exportXml.ts](src/core/services/xml/exportXml.ts)
- [src/core/services/presentationService.ts](src/core/services/presentationService.ts)
- [functions/src/index.ts](functions/src/index.ts#L3396)
- [functions/src/index.ts](functions/src/index.ts#L3561)

Flow summary:

- XML export is user-initiated from extension scope controls and resolved by hierarchy (section → chapter → textbook), then generated through shared XML formatting services. Presentation ingestion/transformation flows are orchestrated in [src/core/services/presentationService.ts](src/core/services/presentationService.ts), including legacy PPT conversion and design-suggestion callable usage. Backend callable endpoints provide conversion/design capabilities while client services map results into persisted presentation artifacts.

Major modules involved:

- XML data assembly/formatting: [src/core/services/xml/exportData.ts](src/core/services/xml/exportData.ts), [src/core/services/xml/formatXml.ts](src/core/services/xml/formatXml.ts)
- Presentation persistence: [src/core/services/repositories/presentationRepository.ts](src/core/services/repositories/presentationRepository.ts)
- Function client transport: [src/firebase/functions.ts](src/firebase/functions.ts)

## Shared Utilities and Components

Assumption:

- This is the Step 4 section to append directly after Step 3, with no edits to Steps 1–3.

### Shared UI Building Blocks

#### Webapp layout shell components

Primary file(s):

- [src/webapp/components/layout/AccordionTile.tsx](src/webapp/components/layout/AccordionTile.tsx)
- [src/webapp/components/layout/Header.tsx](src/webapp/components/layout/Header.tsx)
- [src/webapp/components/layout/Sidebar.tsx](src/webapp/components/layout/Sidebar.tsx)
- [src/webapp/components/layout/WorkflowRibbon.tsx](src/webapp/components/layout/WorkflowRibbon.tsx)

Responsibility summary:

- Provides reusable structural UI primitives for the main workspace, including header actions, ribbon navigation, and collapsible flow sections.
- Keeps page-level screens focused on domain behavior instead of shell rendering concerns.

Consumed by:

- Webapp workspace and authoring routes, especially [src/webapp/components/app/TextbookWorkspace.tsx](src/webapp/components/app/TextbookWorkspace.tsx) and related content/admin pages.

#### Extension reusable sidebar controls

Primary file(s):

- [src/extension/components/QuickAddTabs.tsx](src/extension/components/QuickAddTabs.tsx)
- [src/extension/components/selectors/TextbookSelector.tsx](src/extension/components/selectors/TextbookSelector.tsx)
- [src/extension/components/selectors/ChapterSelector.tsx](src/extension/components/selectors/ChapterSelector.tsx)
- [src/extension/components/selectors/SectionSelector.tsx](src/extension/components/selectors/SectionSelector.tsx)
- [src/extension/components/export/SidebarExportPanel.tsx](src/extension/components/export/SidebarExportPanel.tsx)

Responsibility summary:

- Encapsulates repeated sidebar interactions: scope selection, quick-add mode switching, and export actions.
- Standardizes extension UX around a consistent “select scope then act” pattern.

Consumed by:

- Extension root shell [src/extension/SidebarApp.tsx](src/extension/SidebarApp.tsx), quick capture workflows, and XML export path.

---

### Shared Hooks and State Helpers

#### Webapp repository facade hook

Primary file(s):

- [src/webapp/hooks/useRepositories.ts](src/webapp/hooks/useRepositories.ts)
- [src/core/services/repositories/index.ts](src/core/services/repositories/index.ts)

Responsibility summary:

- Provides a single hook-level API for CRUD operations and entity construction defaults, including local-first metadata like pendingSync and source.
- Shields UI components from direct repository and data-shaping details.

Consumed by:

- Webapp authoring surfaces (textbooks/chapters/sections/content), ingestion, and setup flows.

#### Extension repository facade hook

Primary file(s):

- [src/extension/hooks/useRepositories.ts](src/extension/hooks/useRepositories.ts)
- [src/core/services/repositories/index.ts](src/core/services/repositories/index.ts)

Responsibility summary:

- Offers lightweight, section-scoped create/fetch operations tailored to extension quick-capture constraints.
- Adds hierarchy integrity guards before persisting content entities.

Consumed by:

- Extension quick forms and selector-driven workflows in [src/extension/SidebarApp.tsx](src/extension/SidebarApp.tsx).

#### Auth and autosync bootstrap hooks

Primary file(s):

- [src/webapp/hooks/useAuthBootstrap.ts](src/webapp/hooks/useAuthBootstrap.ts)
- [src/webapp/hooks/useAutoSync.ts](src/webapp/hooks/useAutoSync.ts)
- [src/webapp/hooks/useGlobalShortcuts.ts](src/webapp/hooks/useGlobalShortcuts.ts)

Responsibility summary:

- Centralizes startup orchestration: auth restoration, claim refresh, initial sync, periodic sync, and keyboard shortcut behavior.
- Reduces repeated side-effect logic in route and workspace components.

Consumed by:

- App root [src/webapp/App.tsx](src/webapp/App.tsx) and workspace shell [src/webapp/components/app/TextbookWorkspace.tsx](src/webapp/components/app/TextbookWorkspace.tsx).

#### Global UI/auth stores

Primary file(s):

- [src/webapp/store/uiStore.ts](src/webapp/store/uiStore.ts)
- [src/webapp/store/authStore.ts](src/webapp/store/authStore.ts)

Responsibility summary:

- Maintains shared session, sync, theme, language, accessibility, and selection state with consistent setter APIs.
- Acts as the shared runtime state contract across routing, sync, admin, and authoring UI.

Consumed by:

- Webapp auth guards, bootstrap/sync hooks, admin and authoring panels, and settings/accessibility flows.

---

### Shared Repository and Service Bridges

#### Core services barrel and domain service layer

Primary file(s):

- [src/core/services/index.ts](src/core/services/index.ts)
- [src/core/services/syncService.ts](src/core/services/syncService.ts)
- [src/core/services/documentIngestService.ts](src/core/services/documentIngestService.ts)
- [src/core/services/presentationService.ts](src/core/services/presentationService.ts)

Responsibility summary:

- Provides the primary cross-domain service surface (sync, ingestion, presentation, i18n, debug, translation, admin helpers) via a stable import layer.
- Concentrates orchestration logic that spans local storage, cloud calls, and domain repositories.

Consumed by:

- Webapp flows, extension flows, admin tooling, ingestion/OCR, and export/presentation workflows.

#### Repository barrels and typed entity maps

Primary file(s):

- [src/core/services/repositories/index.ts](src/core/services/repositories/index.ts)
- [src/core/models/index.ts](src/core/models/index.ts)
- [src/core/models/entities.ts](src/core/models/entities.ts)

Responsibility summary:

- Defines canonical entity types and exposes repository operations through consolidated module boundaries.
- Ensures both UI surfaces use the same data contracts and persistence semantics.

Consumed by:

- Core services, webapp hooks, extension hooks, sync pipeline, and tests.

#### IndexedDB foundation

Primary file(s):

- [src/core/services/db.ts](src/core/services/db.ts)

Responsibility summary:

- Implements shared local persistence primitives (initDB, getAll, getById, save, delete) and canonical store names.
- Serves as the local-first persistence base layer for repositories and startup warmup.

Consumed by:

- Repository modules, sync service, app bootstrap, ingest fingerprint tracking, and presentation persistence.

---

### Logging, Config, and Environment Helpers

#### Debug log subsystem

Primary file(s):

- [src/core/services/debugLogService.ts](src/core/services/debugLogService.ts)

Responsibility summary:

- Implements structured debug event capture, retention sizing, local persistence fallback, policy caching, and upload-to-functions integration.
- Provides a uniform diagnostics pipeline for capture/OCR/sync and troubleshooting.

Consumed by:

- Auto textbook extraction and ingestion flows, admin debug panels/policies, and cloud debug-report callables.

#### Firebase config guardrails

Primary file(s):

- [src/firebase/firebaseConfig.ts](src/firebase/firebaseConfig.ts)

Responsibility summary:

- Centralizes Firebase project config and validates against placeholder/misconfigured values.
- Prevents silent auth/cloud failures by surfacing actionable configuration errors.

Consumed by:

- Firebase app initialization and sign-in flow in [src/firebase/auth.ts](src/firebase/auth.ts).

#### Runtime/platform helpers

Primary file(s):

- [src/webapp/utils/platform.ts](src/webapp/utils/platform.ts)

Responsibility summary:

- Encapsulates environment detection and Chrome tab capture capability checks.
- Keeps platform-specific branches out of onboarding and capture components.

Consumed by:

- Auto setup/capture flow in [src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx](src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx).

---

### Firebase Client Wiring

#### Shared Firebase app singleton and clients

Primary file(s):

- [src/firebase/firebaseApp.ts](src/firebase/firebaseApp.ts)
- [src/firebase/firestore.ts](src/firebase/firestore.ts)
- [src/firebase/functions.ts](src/firebase/functions.ts)
- [src/firebase/storage.ts](src/firebase/storage.ts)

Responsibility summary:

- Exposes singleton Firebase app and typed service clients for Firestore, callable Functions, and Storage.
- Includes dev-focused Firestore log-level setup to improve debugging signal.

Consumed by:

- Auth/session flows, repository-adjacent services, sync services, cover upload, ingestion/presentation callables, and admin tooling.

#### Auth utility layer

Primary file(s):

- [src/firebase/auth.ts](src/firebase/auth.ts)

Responsibility summary:

- Provides shared auth operations (persistent initialization, sign-in/out, token listeners, claim reads, profile upsert) across browser and extension runtimes.
- Encodes runtime-specific auth initialization while preserving a common consumer API.

Consumed by:

- Webapp bootstrap/hooks, auth guards, sync identity context, and extension auth communication paths.

---

### Formatting, Validation, and Retry/Error Utilities

#### XML formatting and validation utilities

Primary file(s):

- [src/core/services/xml/index.ts](src/core/services/xml/index.ts)
- [src/core/services/xml/exportXml.ts](src/core/services/xml/exportXml.ts)
- [src/core/services/xml/formatXml.ts](src/core/services/xml/formatXml.ts)
- [src/core/services/xml/escapeXml.ts](src/core/services/xml/escapeXml.ts)
- [src/core/services/xml/errors.ts](src/core/services/xml/errors.ts)

Responsibility summary:

- Centralizes XML export orchestration, escaping/formatting, and explicit validation errors for textbook/chapter/section exports.
- Provides a stable export API reused across web and extension contexts.

Consumed by:

- Extension export panel, webapp export actions, and XML regression tests.

#### Equation normalization and repair helper

Primary file(s):

- [src/core/services/equationFormatService.ts](src/core/services/equationFormatService.ts)

Responsibility summary:

- Normalizes equation input across LaTeX, Word-linear, OMML, and MathML, with corruption detection and repair suggestions.
- Provides consistent equation semantics regardless of ingestion source format.

Consumed by:

- Document ingest save/review flows and presentation extraction/normalization.

#### Dual-sync retry/reconciliation helper layer

Primary file(s):

- [src/services/syncService.ts](src/services/syncService.ts)
- [src/services/azureSyncService.ts](src/services/azureSyncService.ts)

Responsibility summary:

- Implements queue-backed retry, conflict reconciliation, and timestamp-based source-of-truth selection across Firebase and Azure.
- Encapsulates exponential backoff and durable pending-write behavior.

Consumed by:

- Cross-surface sync reliability path and cloud reconciliation workflows.

#### Cloud Functions backend shared guards/utilities

Primary file(s):

- [functions/src/index.ts](functions/src/index.ts)
- [functions/src/documentExtraction.ts](functions/src/documentExtraction.ts)

Responsibility summary:

- Provides reusable backend callable envelope/authorization helpers and shared extraction-quality utilities used by multiple callable endpoints.
- Keeps function handlers consistent in response shape, admin enforcement, and document normalization/quality analysis.

Consumed by:

- Admin governance callables, OCR/extraction callables, presentation callables, and moderation pipelines.

---

## Updates (2026-04-04 Upload Telemetry)

### Sync Read Budget Guard (Auto Sync)

Primary file(s):

- [src/core/services/syncService.ts](src/core/services/syncService.ts)
- [src/webapp/hooks/useAutoSync.ts](src/webapp/hooks/useAutoSync.ts)
- [src/webapp/hooks/useAuthBootstrap.ts](src/webapp/hooks/useAuthBootstrap.ts)

Update summary:

- Added `intent` routing to `syncNow` (`bootstrap | auto | manual`) so auto-sync runs can short-circuit when there are no pending local changes.
- Auto-sync hook now calls `syncNow({ intent: "auto" })`, preventing repeated cloud reconciliation reads while idle.
- Auth bootstrap now calls `syncNow({ intent: "bootstrap" })` to preserve startup sync semantics while keeping intent explicit for diagnostics.

### TOC Capture and Autosave Hardening

Primary file(s):

- [src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx](src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx)
- [src/core/services/textbookAutoExtractionService.ts](src/core/services/textbookAutoExtractionService.ts)
- [tests/core/tocAutosaveService.test.ts](tests/core/tocAutosaveService.test.ts)
- [tests/core/tocGroundTruthPipeline.test.ts](tests/core/tocGroundTruthPipeline.test.ts)

Update summary:

- Fixed TOC editor save action markup and compatibility labels, restored valid button hierarchy, and moved inline warning/action styles into CSS classes.
- Tightened upload validation to require cover + copyright metadata signal + TOC while still supporting local-only save flow.
- Improved unit parsing/stitching so unit chapter membership and page ranges remain stable across multipage TOC merges, including prevention of duplicated `Unit X Unit X` labels.
- Stabilized TOC autosave tests by removing fake-timer blocking around IndexedDB initialization and using real debounce waits.
- Updated parser ground-truth assertion to ignore optional `units` in strict fixture parity checks.

### TOC Unit Hierarchy and Manual Recovery Controls

Primary file(s):

- [src/core/services/textbookAutoExtractionService.ts](src/core/services/textbookAutoExtractionService.ts)
- [src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx](src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx)
- [src/webapp/components/textbooks/TextbookForm.tsx](src/webapp/components/textbooks/TextbookForm.tsx)
- [src/core/services/syncService.ts](src/core/services/syncService.ts)
- [tests/core/textbookAutoExtractionService.test.ts](tests/core/textbookAutoExtractionService.test.ts)
- [tests/integration/autoTextbookFlow.integration.test.tsx](tests/integration/autoTextbookFlow.integration.test.tsx)

Update summary:

- TOC parsing now hard-detects unit headers across OCR variants and keeps units in stitched hierarchy results with chapter parentage preserved.
- TOC editor includes an `Add Missing Hierarchy Level` tool for manual recovery (`unit | chapter | section | subsection`), with reassignment and reorder controls that preserve downstream hierarchy.
- TOC editor hierarchy edits synchronize into TOC page snapshots so autosave and final payload generation stay aligned with manual corrections.
- End-of-TOC save behavior is mode-specific: cloud mode shows `Save Textbook to Cloud`; local mode uses local-only persistence and sets cloud sync blocking (`user_blocked`) until explicit cloud upload is chosen later.

### Design System Controls Preview Layout Refinement (2026-04-12)

Primary file(s):

- [src/webapp/components/settings/DesignSystemSettingsCard.tsx](src/webapp/components/settings/DesignSystemSettingsCard.tsx)
- [src/webapp/styles/globals.css](src/webapp/styles/globals.css)
- [tests/integration/designSystemSettingsCard.integration.test.tsx](tests/integration/designSystemSettingsCard.integration.test.tsx)

Update summary:

- The Example Card preview now uses denser preview layouts for modular-scale inspection: Type Scale is rendered as a 2x3 grid and Spacing Scale as a 2x2 grid to reduce vertical space while preserving token comparisons.
- Motion Preview remains horizontally paired with Motion Controls but now scales its preview cluster to occupy most of the available row width, improving legibility of timing and directional-flow behavior.
- Button contrast validation was tightened for `ghost` and `secondary sm` preview buttons with explicit light/dark theme treatments and runtime debug validation of contrast calculations.

### Windows Port Cleanup PID Matching Hardening (2026-04-13)

Primary file(s):

- [scripts/installer/courseforge-serve.js](scripts/installer/courseforge-serve.js)
- [scripts/preflight-port-cleanup.mjs](scripts/preflight-port-cleanup.mjs)

Update summary:

- Windows port ownership detection now filters `netstat` results down to exact local `LISTENING` sockets for the requested port instead of matching any line containing `:<port>`.
- This prevents updater port-cleanup flows and preflight cleanup from selecting unrelated PIDs during high socket churn, which previously could terminate the wrong process and destabilize sequential updater integration runs.

## How to Update This Index

- Update triggers:
  - Add or revise content when a new top-level domain is introduced.
  - Update when a major runtime flow changes (bootstrap, auth, sync, ingestion, moderation, export).
  - Update after significant refactors that move ownership between core/webapp/extension/firebase/services/functions.
  - Update when new shared utilities/components become cross-cutting dependencies.

- Safe append process:
  - Preserve existing Step 1–4 content exactly unless explicitly instructed to revise a specific step.
  - Append new step sections at the end using stable markdown headings and keep the same section ordering style.
  - For each new section entry, include primary files, concise responsibility summary, and consumption notes.
  - Prefer additive edits; avoid restructuring existing headings unless explicitly requested.

- Index policy:
  - This index is append-only unless explicitly instructed otherwise.
  - If a correction is required, add a clearly labeled amendment section rather than silently rewriting prior sections.

## Maintenance Guide

### When to update this index

- Update after introducing a new domain or major feature area that changes ownership boundaries in `core`, `webapp`, `extension`, `firebase`, `services`, or `functions`.
- Update after significant refactors, module migrations, or directory reorganizations that change where responsibilities live.
- Update when a new cross-surface runtime flow is added or materially changed, especially any path spanning webapp, extension, services, and functions.
- Update when new shared utilities, service layers, orchestration hooks, or repository bridges become reused by multiple surfaces.
- Update when sync, ingestion/OCR/extraction, admin governance/moderation, or export/presentation pipelines change behavior or entry points.

### How to apply updates

- Treat this index as append-only by default.
- Never rewrite earlier sections unless explicitly instructed to revise specific prior steps.
- Add new subsections when new domains, flows, or shared layers emerge instead of folding them into unrelated existing entries.
- Keep entries concise and high-signal: include primary files, short responsibility summaries, and explicit consumption scope.

### Contributor guidance

- Determine index impact during PR review by asking: did this change alter domain boundaries, entry points, cross-surface interactions, or shared utility usage?
- Mirror existing structure and tone to preserve consistency: heading depth, bullet style, and the "Primary file(s) / Responsibility / Consumed by" pattern where applicable.
- When boundaries are ambiguous, document assumptions explicitly so future contributors can refine them without rewriting historical sections.
- Prefer additive clarifications (new subsection or amendment note) over destructive edits to maintain long-term architectural traceability.

## Search Tips

### Domain keyword starters

- Curriculum modeling: `Textbook|Chapter|Section|VocabTerm|Concept|Equation|KeyIdea`, `entities.ts`, `repository`, `list.*BySectionId`.
- Sync and reconciliation: `pendingSync`, `syncNow`, `syncUserData`, `uploadLocalChanges`, `downloadCloudData`, `writeBudget`, `writeLoop`, `reconcile`.
- Auth and authorization: `initializePersistentAuth`, `onIdTokenChanged`, `getAdminClaim`, `RequireAuth`, `RequireAdmin`, `assertAdmin`.
- Ingestion and OCR: `DocumentIngestPanel`, `extractFromDocuments`, `extractDocumentContent`, `extractScreenshotText`, `AutoTextbookSetupFlow`, `metadataExtraction`.
- Admin governance: `AdminToolsPage`, `ModerationQueue`, `setUserAdminStatus`, `getModerationQueue`, `updateModerationStatus`, `premium`.
- Translation and localization: `i18nService`, `translationMemory`, `translationReview`, `glossary`, `locales/`.
- Authoring flows: `TextbookWorkspace`, `SectionContentPanel`, `useRepositories`, `QuickVocabForm`, `QuickConceptForm`.
- Export and presentation: `exportTextbookXml`, `exportChapterXml`, `exportSectionXml`, `formatXml`, `presentationService`, `convertPresentationFile`.

### Useful patterns and prefixes

- Hook discovery: search `^use[A-Z]` (regex) in [src/webapp/hooks](src/webapp/hooks) and [src/extension/hooks](src/extension/hooks).
- Service discovery: search `Service.ts` and `*.service.ts` equivalents under [src/core/services](src/core/services) and [src/services](src/services).
- Repository bridge discovery: search `from "../../core/services/repositories"` and `save|list|get.*ById` within hook files.
- Sync markers: search `pendingSync|source:\s*"local"|source:\s*"cloud"`.
- Callable wiring: search `httpsCallable\(` in [src](src) and `export const .* = onCall` in [functions/src/index.ts](functions/src/index.ts).
- XML/export internals: search `export.*Xml|formatCurriculumXml|load.*ExportNode|XmlExport` in [src/core/services/xml](src/core/services/xml).

### Tracing flows across surfaces

- Webapp to core: start at [src/webapp/main.tsx](src/webapp/main.tsx) and [src/webapp/App.tsx](src/webapp/App.tsx), then follow imported hooks into [src/webapp/hooks](src/webapp/hooks) and service calls into [src/core/services](src/core/services).
- Extension to core: start at [src/extension/main.tsx](src/extension/main.tsx) and [src/extension/SidebarApp.tsx](src/extension/SidebarApp.tsx), then follow [src/extension/hooks/useRepositories.ts](src/extension/hooks/useRepositories.ts) into repository/service modules.
- Core to Firebase: trace imports from [src/core/services](src/core/services) into [src/firebase/auth.ts](src/firebase/auth.ts), [src/firebase/firestore.ts](src/firebase/firestore.ts), [src/firebase/functions.ts](src/firebase/functions.ts), and [src/firebase/storage.ts](src/firebase/storage.ts).
- Firebase/functions round-trip: from `httpsCallable` callers in client services to matching `onCall` exports in [functions/src/index.ts](functions/src/index.ts).

### Fast location map

- Entry points:
  - Webapp: [src/webapp/main.tsx](src/webapp/main.tsx), [src/webapp/App.tsx](src/webapp/App.tsx)
  - Extension: [src/extension/main.tsx](src/extension/main.tsx), [src/extension/background.js](src/extension/background.js)
  - Functions: [functions/src/index.ts](functions/src/index.ts)
- Cross-surface bridges:
  - Hook bridges: [src/webapp/hooks/useRepositories.ts](src/webapp/hooks/useRepositories.ts), [src/extension/hooks/useRepositories.ts](src/extension/hooks/useRepositories.ts)
  - Sync bridges: [src/core/services/syncService.ts](src/core/services/syncService.ts), [src/services/syncService.ts](src/services/syncService.ts)
- Shared utilities:
  - Core barrel: [src/core/services/index.ts](src/core/services/index.ts)
  - DB layer: [src/core/services/db.ts](src/core/services/db.ts)
  - Debug/i18n helpers: [src/core/services/debugLogService.ts](src/core/services/debugLogService.ts), [src/core/services/i18nService.ts](src/core/services/i18nService.ts)
- Cloud callables:
  - Client call sites: search `httpsCallable(` in [src/core/services](src/core/services)
  - Server handlers: [functions/src/index.ts](functions/src/index.ts)
- XML/export logic:
  - API surface: [src/core/services/xml/index.ts](src/core/services/xml/index.ts)
  - Export pipeline: [src/core/services/xml/exportXml.ts](src/core/services/xml/exportXml.ts), [src/core/services/xml/exportData.ts](src/core/services/xml/exportData.ts), [src/core/services/xml/formatXml.ts](src/core/services/xml/formatXml.ts)

## Updates (2026-04-04)

### Auto Textbook Cloud Upload Telemetry, Resume, and Integrity Recovery

- New tracked upload orchestration now lives in [src/core/services/autoTextbookUploadService.ts](src/core/services/autoTextbookUploadService.ts) and is exported via [src/core/services/index.ts](src/core/services/index.ts).
- Upload progress is persisted to local storage and mirrored into global UI state through [src/webapp/store/uiStore.ts](src/webapp/store/uiStore.ts), enabling visibility across page navigation.
- The Auto TOC editor now provides top and bottom save action bars in [src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx](src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx) so long TOC captures no longer force scrolling to the bottom to start upload.
- Upload telemetry is rendered outside the Auto flow in [src/webapp/components/layout/Header.tsx](src/webapp/components/layout/Header.tsx) and [src/webapp/components/settings/SettingsPage.tsx](src/webapp/components/settings/SettingsPage.tsx), so users can monitor progress while viewing settings/write-rate indicators.
- Resume flow performs a cloud integrity check and local/cloud diff before upload continues, then uploads only missing hierarchy records (textbook/chapter/section) and restarts from a clean cloud hierarchy if corruption/mismatch is detected.
- Duplicate-resolution behavior now supports preserving both records when Auto metadata collides with an existing manual textbook; the new `keep_both` mode is represented in [src/core/services/autoTextbookConflictService.ts](src/core/services/autoTextbookConflictService.ts) and used by [src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx](src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx).
- User duplicate-preference memory (for ISBN-scoped keep-both behavior) is handled by the tracked upload service and applied during Auto save decisions.

Assumptions and scope note:

- Integrity recovery currently targets textbook/chapter/section hierarchy continuity and ownership consistency; deeper content stores (vocab/concepts/equations/key ideas) continue to rely on existing sync reconciliation paths.

### Auto Metadata Checklist and TOC Duplicate-Lesson Dedupe

- The Auto metadata review banner in [src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx](src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx) now shows a step-scoped checklist instead of reusing the last capture's positive field list, so entering the copyright step no longer inherits green checks from the cover step.
- Cover and copyright checklist items stay pending until that same step actually extracts them; existing carried-forward metadata values no longer count as fresh extraction proof for the active step.
- TOC stitching in [src/core/services/textbookAutoExtractionService.ts](src/core/services/textbookAutoExtractionService.ts) now collapses conflicting duplicate numbered lesson variants before page-range inference, reducing OCR-noise cases where the same lesson number appeared twice with mismatched titles/pages and distorted downstream ranges in [src/webapp/components/textbooks/tocPreview/PageRangeCalculator.ts](src/webapp/components/textbooks/tocPreview/PageRangeCalculator.ts).

## Updates (2026-04-12)

### Verbose Trace Copy UX and Upload Communication Recovery

- The verbose trace panel in [src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx](src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx) now includes an interactive full-copy action with hover, press, and copied-success states while keeping the full JSON trace scrollable/selectable in place.
- Trace rendering now preserves complete JSON payload fidelity for long runs and is still gated behind the verbose-debug toggle in the Auto setup flow.
- Tracked cloud upload in [src/core/services/autoTextbookUploadService.ts](src/core/services/autoTextbookUploadService.ts) now emits detailed communication-stage trace hooks for request payload, integrity response, retry attempts, timeout, and completion/failure outcomes.
- Communication pipeline recovery now auto-retries throttled upload sync attempts with cooldown, marks timeout failures as resumable, and avoids non-resumable hard-fail states for transient communication errors.
- Regression coverage was added in [tests/core/autoTextbookUploadResume.test.ts](tests/core/autoTextbookUploadResume.test.ts) and [tests/integration/autoTextbookFlow.integration.test.tsx](tests/integration/autoTextbookFlow.integration.test.tsx) for throttled-upload recovery and full-trace copy interactions.

### Permanent Codex Update: Design System, Layout, Motion, Cache Flush, And Trace Governance

Primary file(s):

- [.github/copilot-instructions.md](.github/copilot-instructions.md)
- [src/core/services/designSystemService.ts](src/core/services/designSystemService.ts)
- [src/webapp/components/settings/DesignSystemSettingsCard.tsx](src/webapp/components/settings/DesignSystemSettingsCard.tsx)
- [src/webapp/components/skeleton/Skeleton.tsx](src/webapp/components/skeleton/Skeleton.tsx)
- [src/webapp/main.tsx](src/webapp/main.tsx)

Update summary:

- Repository-level agent instructions now treat the token-driven atomic design system as permanent architecture: tokens -> atoms -> molecules -> organisms -> pages.
- Future UI work is expected to use centralized tokens for color, type, stroke, spacing, motion, semantic states, skeleton loading, settings safety, persistence, and recovery paths.
- Fibonacci layout methodology is now a permanent rule for multi-card compositions, with Example Card occupying the larger ratio and Controls Card occupying the smaller ratio by default.
- Motion choreography is standardized as `ease-in` for entering, `ease-in-out` for moving, and `ease-out` for exiting, with timing sourced from motion settings and direction sourced from directional-flow.
- Structure-aware skeleton loaders are now part of the permanent design contract for known-layout loading states.
- First-run OS/browser preference detection, cloud settings choice handling, corrupted-settings recovery, and CLI recovery expectations are now encoded as permanent instruction-level behavior for future agents and refactors.
- Development-mode cache flushing is now a canonical prototyping rule to reduce stale-state regressions for UI and design-system work.
- Debug/trace expectations now explicitly include layout choices, Fibonacci ratio decisions, motion decisions, cache flush events, system detection attempts, cloud settings handling, corruption recovery actions, skeleton activation, preview updates, and fallback logic.
