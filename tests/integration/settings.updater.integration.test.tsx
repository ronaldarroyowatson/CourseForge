import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "../../src/webapp/components/settings/SettingsPage";
import { useAuthStore } from "../../src/webapp/store/authStore";
import { useUIStore } from "../../src/webapp/store/uiStore";

const firestoreMocks = vi.hoisted(() => ({
  doc: vi.fn(() => ({ path: "users/mock" })),
  setDoc: vi.fn(async () => undefined),
}));

const coreServiceMocks = vi.hoisted(() => ({
  dscInstalled: false,
  pluginStatusSubscribers: new Set<(event: { statuses: Array<{ manifest: { id: string }; installed: boolean; loaded: boolean }> }) => void>(),
  buildFullDebugReport: vi.fn(() => ({
    generatedAt: "2026-04-17T00:00:00.000Z",
    debugEnabled: true,
    tokenResolution: [],
    uiIntrospection: { pageId: "settings", cardId: "debug-log" },
    cascadingFailureDetector: { hasRisk: false, reasons: [] },
  })),
  getDesignTokenDebugReport: vi.fn(() => ({
    enabled: true,
    page: { id: "settings", label: "Settings" },
    card: {
      id: "debug-log",
      label: "Debug Log",
      components: [
        { id: "debug-toggle", label: "Enable Debug Logging", type: "toggle" },
        { id: "debug-clear", label: "Clear Debug Log", type: "button" },
        { id: "debug-send", label: "Send Debug Log to Cloud", type: "button" },
        { id: "debug-introspection", label: "Token Introspection", type: "summary" },
      ],
    },
    tokens: {
      MAJOR: { resolvedValue: "#2563EB", status: "resolved", source: "--cf-accent" },
      MINOR: { resolvedValue: "#73A2F5", status: "resolved", source: "--cf-accent-strong" },
      ACCENT: { resolvedValue: "#FFFFFF", status: "resolved", source: "--cf-text-on-accent" },
      SUCCESS: { resolvedValue: "#22C55E", status: "resolved", source: "--cf-success" },
      WARNING: { resolvedValue: "#FACC15", status: "resolved", source: "--cf-warning" },
      ERROR: { resolvedValue: "#EF4444", status: "resolved", source: "--cf-danger" },
      INFO: { resolvedValue: "#06B6D4", status: "resolved", source: "--cf-info" },
    },
    mismatches: [],
    cascadingFailureRisk: { level: "none", summary: "No cascading token failures detected.", impactedTokens: [] },
  })),
  clearDebugLogEntries: vi.fn(async () => undefined),
  getDebugLoggingPolicy: vi.fn(async () => ({ enabledGlobally: true })),
  getDebugLogStorageStats: vi.fn(async () => ({
    entries: 0,
    totalBytes: 0,
    maxTotalBytes: 1_500_000,
    maxUploadBytes: 500 * 1024,
    lastUploadTimestamp: null,
  })),
  isDebugLoggingEnabled: vi.fn(() => false),
  isMetadataCorrectionSharingEnabled: vi.fn(() => false),
  readLocalCorrectionRecords: vi.fn<() => unknown[]>(() => []),
  setMetadataCorrectionSharingEnabled: vi.fn(),
  setDebugLoggingEnabled: vi.fn(),
  uploadAndClearDebugLogs: vi.fn(async () => ({ uploadedCount: 0 })),
  getPluginStatus: vi.fn(async () => ({
    manifest: { id: "dsc", name: "Design System Controls", version: "1.0.0", optional: true, entry: "./index.ts", description: "" },
    installed: coreServiceMocks.dscInstalled,
    loaded: coreServiceMocks.dscInstalled,
  })),
  getPluginStatusesSnapshot: vi.fn(() => ([{
    manifest: { id: "dsc", name: "Design System Controls", version: "1.0.0", optional: true, entry: "./index.ts", description: "" },
    installed: coreServiceMocks.dscInstalled,
    loaded: coreServiceMocks.dscInstalled,
  }])),
  subscribePluginStatusChanges: vi.fn((listener: (event: { statuses: Array<{ manifest: { id: string }; installed: boolean; loaded: boolean }> }) => void) => {
    coreServiceMocks.pluginStatusSubscribers.add(listener);
    return () => {
      coreServiceMocks.pluginStatusSubscribers.delete(listener);
    };
  }),
  loadPlugin: vi.fn(async () => ({
    manifest: { id: "dsc", name: "Design System Controls", version: "1.0.0", optional: true, entry: "./index.ts", description: "" },
    installed: coreServiceMocks.dscInstalled,
    loaded: coreServiceMocks.dscInstalled,
  })),
  unloadPlugin: vi.fn(async () => ({
    manifest: { id: "dsc", name: "Design System Controls", version: "1.0.0", optional: true, entry: "./index.ts", description: "" },
    installed: coreServiceMocks.dscInstalled,
    loaded: false,
  })),
  installPlugin: vi.fn(async () => {
    coreServiceMocks.dscInstalled = true;
    coreServiceMocks.pluginStatusSubscribers.forEach((listener) => {
      listener({
        statuses: [{
          manifest: { id: "dsc" },
          installed: true,
          loaded: true,
        }],
      });
    });
    return {
      manifest: { id: "dsc", name: "Design System Controls", version: "1.0.0", optional: true, entry: "./index.ts", description: "" },
      installed: true,
      loaded: true,
    };
  }),
  uninstallPlugin: vi.fn(async () => {
    coreServiceMocks.dscInstalled = false;
    coreServiceMocks.pluginStatusSubscribers.forEach((listener) => {
      listener({
        statuses: [{
          manifest: { id: "dsc" },
          installed: false,
          loaded: false,
        }],
      });
    });
    return {
      manifest: { id: "dsc", name: "Design System Controls", version: "1.0.0", optional: true, entry: "./index.ts", description: "" },
      installed: false,
      loaded: false,
    };
  }),
  refreshPluginStatus: vi.fn(async () => ({
    manifest: { id: "dsc", name: "Design System Controls", version: "1.0.0", optional: true, entry: "./index.ts", description: "" },
    installed: coreServiceMocks.dscInstalled,
    loaded: coreServiceMocks.dscInstalled,
  })),
}));

const ocrMocks = vi.hoisted(() => ({
  getAutoOcrProviderHealth: vi.fn(async () => [
    { id: "cloud_openai_vision", label: "Cloud OCR (OpenAI Vision)", available: true },
    { id: "local_tesseract", label: "Local OCR (Tesseract)", available: true },
  ]),
  getCloudAutoOcrProviderPolicy: vi.fn(async () => null),
  getEffectiveAutoOcrProviderOrder: vi.fn(async () => ["cloud_openai_vision", "local_tesseract"]),
  setCloudAutoOcrProviderPolicy: vi.fn(async (providerOrder: ["cloud_openai_vision" | "local_tesseract", "cloud_openai_vision" | "local_tesseract"]) => ({
    providerOrder,
  })),
  setAutoOcrProviderOrder: vi.fn((providerOrder: ["cloud_openai_vision" | "local_tesseract", "cloud_openai_vision" | "local_tesseract"]) => providerOrder),
}));

vi.mock("firebase/firestore", () => ({
  doc: firestoreMocks.doc,
  setDoc: firestoreMocks.setDoc,
}));

vi.mock("../../src/firebase/firestore", () => ({
  firestoreDb: {},
}));

vi.mock("../../src/core/services", () => ({
  buildFullDebugReport: coreServiceMocks.buildFullDebugReport,
  getDesignTokenDebugReport: coreServiceMocks.getDesignTokenDebugReport,
  clearDebugLogEntries: coreServiceMocks.clearDebugLogEntries,
  getDebugLoggingPolicy: coreServiceMocks.getDebugLoggingPolicy,
  getDebugLogStorageStats: coreServiceMocks.getDebugLogStorageStats,
  isDebugLoggingEnabled: coreServiceMocks.isDebugLoggingEnabled,
  isMetadataCorrectionSharingEnabled: coreServiceMocks.isMetadataCorrectionSharingEnabled,
  readLocalCorrectionRecords: coreServiceMocks.readLocalCorrectionRecords,
  setMetadataCorrectionSharingEnabled: coreServiceMocks.setMetadataCorrectionSharingEnabled,
  setDebugLoggingEnabled: coreServiceMocks.setDebugLoggingEnabled,
  uploadAndClearDebugLogs: coreServiceMocks.uploadAndClearDebugLogs,
  getPluginStatus: coreServiceMocks.getPluginStatus,
  getPluginStatusesSnapshot: coreServiceMocks.getPluginStatusesSnapshot,
  subscribePluginStatusChanges: coreServiceMocks.subscribePluginStatusChanges,
  loadPlugin: coreServiceMocks.loadPlugin,
  unloadPlugin: coreServiceMocks.unloadPlugin,
  installPlugin: coreServiceMocks.installPlugin,
  uninstallPlugin: coreServiceMocks.uninstallPlugin,
  refreshPluginStatus: coreServiceMocks.refreshPluginStatus,
}));

vi.mock("../../src/core/services/autoOcrService", () => ({
  getAutoOcrProviderHealth: ocrMocks.getAutoOcrProviderHealth,
  getCloudAutoOcrProviderPolicy: ocrMocks.getCloudAutoOcrProviderPolicy,
  getEffectiveAutoOcrProviderOrder: ocrMocks.getEffectiveAutoOcrProviderOrder,
  setCloudAutoOcrProviderPolicy: ocrMocks.setCloudAutoOcrProviderPolicy,
  setAutoOcrProviderOrder: ocrMocks.setAutoOcrProviderOrder,
}));

vi.mock("../../src/core/services/translationWorkflowService", () => ({
  fetchLanguageRegistryFromUrl: vi.fn(async () => ({ supported: ["en"], roadmap: [] })),
}));

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

type CheckResponsePayload = {
  ok: boolean;
  available: boolean;
  latestVersion?: string | null;
  currentVersion?: string | null;
  releaseUrl?: string | null;
  error?: string | null;
  stageRequested?: boolean;
  stageAccepted?: boolean;
  stageReason?: string | null;
  stageMessage?: string | null;
  stagePid?: number | null;
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resetStores(): void {
  useAuthStore.setState({
    authStatus: "authenticated",
    userId: "teacher-1",
    userEmail: "teacher@example.com",
    userDisplayName: "Teacher",
    isAdmin: false,
    authError: null,
  });

  useUIStore.setState({
    theme: "light",
    language: "en",
    accessibility: {
      colorBlindMode: "none",
      dyslexiaMode: false,
      dyscalculiaMode: false,
      highContrastMode: false,
      fontScale: 1,
      uiScale: 1,
    },
    isSyncing: false,
    syncStatus: "idle",
    syncMessage: null,
    lastSyncTime: null,
    lastSyncError: null,
    lastSyncErrorCode: null,
    pendingSyncCount: 0,
    pendingChangesCount: 0,
    writeCount: 0,
    readCount: 0,
    retryCount: 0,
    writeBudgetLimit: 500,
    readBudgetLimit: 5000,
    retryLimit: 3,
    writeBudgetExceeded: false,
    readBudgetExceeded: false,
    automaticRetriesEnabled: false,
    permissionDeniedSyncBlocked: false,
    writeLoopBlocked: false,
    localChangeVersion: 0,
    syncDebugEvents: [],
    selectedTextbookId: null,
    selectedTextbook: null,
  });
}

describe("Settings updater communication", () => {
  beforeEach(() => {
    resetStores();
    vi.restoreAllMocks();
    coreServiceMocks.dscInstalled = false;
    coreServiceMocks.pluginStatusSubscribers.clear();
    window.localStorage.clear();
    coreServiceMocks.readLocalCorrectionRecords.mockReturnValue([]);
    coreServiceMocks.isMetadataCorrectionSharingEnabled.mockReturnValue(false);
    ocrMocks.getAutoOcrProviderHealth.mockResolvedValue([
      { id: "cloud_openai_vision", label: "Cloud OCR (OpenAI Vision)", available: true },
      { id: "local_tesseract", label: "Local OCR (Tesseract)", available: true },
    ]);
  });

  it("shows metadata learning health based on local corrections and OCR provider readiness", async () => {
    coreServiceMocks.isMetadataCorrectionSharingEnabled.mockReturnValue(true);
    coreServiceMocks.readLocalCorrectionRecords.mockReturnValue([
      {
        id: "sample-1",
        timestamp: "2026-03-22T12:00:00.000Z",
        pageType: "title",
        publisher: "McGraw-Hill Education",
        series: "Inspire",
        subject: "Science",
        originalVisionOutput: null,
        originalOcrOutput: { rawText: "Inspire Physical Science with Earth Science" },
        finalMetadata: {
          title: "Inspire Physical Science",
          subtitle: "with Earth Science",
          edition: null,
          publisher: "McGraw-Hill Education",
          publisherLocation: null,
          series: "Inspire",
          gradeLevel: null,
          subject: "Science",
          copyrightYear: 2021,
          isbn: null,
          confidence: 0.93,
          rawText: "Inspire Physical Science with Earth Science",
          source: "ocr",
        },
        imageReference: null,
        flagged: false,
        finalConfidence: 0.93,
        errorScore: 0.07,
        reviewStatus: "pending",
      },
      {
        id: "sample-2",
        timestamp: "2026-03-22T13:00:00.000Z",
        pageType: "title",
        publisher: "McGraw-Hill Education",
        series: "Inspire",
        subject: "Science",
        originalVisionOutput: null,
        originalOcrOutput: { rawText: "Module 1 The Nature of Science" },
        finalMetadata: {
          title: "Inspire Physical Science",
          subtitle: "with Earth Science",
          edition: null,
          publisher: "McGraw-Hill Education",
          publisherLocation: null,
          series: "Inspire",
          gradeLevel: null,
          subject: "Science",
          copyrightYear: 2021,
          isbn: null,
          confidence: 0.52,
          rawText: "Module 1 The Nature of Science",
          source: "ocr",
        },
        imageReference: null,
        flagged: true,
        reasonFlagged: "Final confidence below 0.65.",
        finalConfidence: 0.52,
        errorScore: 0.48,
        reviewStatus: "pending",
      },
    ]);

    render(<SettingsPage onBack={() => undefined} />);

    const metadataLearningCard = screen.getByText("Metadata Learning").closest("article");
    expect(metadataLearningCard).not.toBeNull();
    fireEvent.click(within(metadataLearningCard as HTMLElement).getByRole("button", { name: "Show" }));

    await waitFor(() => {
      expect(screen.getByText("Queued locally:", { exact: false })).toBeInTheDocument();
      expect(screen.getByText("Cloud OCR health: Cloud OCR providers are ready. Local OCR remains the final fallback.")).toBeInTheDocument();
      expect(screen.getByText("Local learning: Local learning has 2 correction samples recorded.")).toBeInTheDocument();
      expect(screen.getByText("Correction sync: 1 correction sample is held for review before upload.")).toBeInTheDocument();
    });
  });

  it("makes a manual check call, reads latest release data, and reports updater detection state", async () => {
    const fetchCalls: FetchCall[] = [];
    let checkCallCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, init });

      if (url.includes("/api/update-status")) {
        return jsonResponse({ available: false, currentVersion: "1.2.76" });
      }

      if (url.includes("/api/check-for-updates")) {
        checkCallCount += 1;
        const payload: CheckResponsePayload = checkCallCount === 1
          ? {
              ok: true,
              available: false,
              latestVersion: "1.2.76",
              currentVersion: "1.2.76",
            }
          : {
              ok: true,
              available: true,
              latestVersion: "1.2.77",
              currentVersion: "1.2.76",
              releaseUrl: "https://example.invalid/releases/tag/v1.2.77",
              stageRequested: true,
              stageAccepted: true,
              stageReason: "started",
              stageMessage: "Update download and staging started in the background.",
              stagePid: 1184,
            };
        return jsonResponse(payload);
      }

      if (url.includes("/api/updater-progress")) {
        return jsonResponse({
          state: "idle",
          currentVersion: "1.2.76",
          latestVersion: "1.2.80",
          message: "Waiting for next background check",
        });
      }

      if (url.includes("/api/updater-diagnostics")) {
        return jsonResponse({
          checkedAt: "2026-03-20T00:00:00.000Z",
          lastCheck: { ok: true, latestVersion: "1.2.77" },
          updaterLogTail: ["Manual update check requested via /api/check-for-updates."],
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage onBack={() => undefined} />);

    await waitFor(() => {
      expect(screen.getAllByText("v1.2.80").length).toBeGreaterThanOrEqual(1);
    });

    const preManualCheckCalls = fetchCalls.filter((call) => call.url.includes("/api/check-for-updates")).length;

    fireEvent.click(screen.getByRole("button", { name: "Check for Updates" }));

    await waitFor(() => {
      expect(screen.getByText("Update available: v1.2.77. Download and staging started in the background (PID 1184)."))
        .toBeInTheDocument();
    });

    const allManualCheckCalls = fetchCalls.filter((call) => call.url.includes("/api/check-for-updates"));
    expect(allManualCheckCalls.length).toBe(preManualCheckCalls + 1);

    const latestManualCall = allManualCheckCalls.at(-1);
    expect(latestManualCall?.url).toMatch(/\/api\/check-for-updates\?_ts=\d+/);
    expect(latestManualCall?.init?.cache).toBe("no-store");
    expect(latestManualCall?.init?.method ?? "GET").toBe("GET");
  });

  it("surfaces manual check failures and forces diagnostics refresh for clear debug visibility", async () => {
    const fetchCalls: FetchCall[] = [];
    let checkCallCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, init });

      if (url.includes("/api/update-status")) {
        return jsonResponse({ available: false, currentVersion: "1.2.76" });
      }

      if (url.includes("/api/check-for-updates")) {
        checkCallCount += 1;
        if (checkCallCount === 1) {
          return jsonResponse({
            ok: true,
            available: true,
            latestVersion: "1.2.77",
            currentVersion: "1.2.76",
          });
        }

        return jsonResponse(
          {
            ok: false,
            available: false,
            error: "Latest release request failed with status 404.",
          },
          502
        );
      }

      if (url.includes("/api/updater-progress")) {
        return jsonResponse({ state: "idle", currentVersion: "1.2.76", latestVersion: "1.2.77" });
      }

      if (url.includes("/api/updater-diagnostics")) {
        return jsonResponse({
          checkedAt: "2026-03-20T00:00:00.000Z",
          lastCheck: {
            ok: false,
            error: "Latest release request failed with status 404.",
            diagnostics: { responseStatus: 404 },
          },
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage onBack={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText("Current version:")).toBeInTheDocument();
    });

    const diagnosticsBeforeClick = fetchCalls.filter((call) => call.url.includes("/api/updater-diagnostics")).length;

    fireEvent.click(screen.getByRole("button", { name: "Check for Updates" }));

    await waitFor(() => {
      expect(screen.getByText("Update check failed (502): Latest release request failed with status 404.")).toBeInTheDocument();
    });

    await act(async () => {
      await Promise.resolve();
    });

    const diagnosticsAfterClick = fetchCalls.filter((call) => call.url.includes("/api/updater-diagnostics")).length;
    expect(diagnosticsAfterClick).toBe(diagnosticsBeforeClick + 1);

    const failedManualCall = fetchCalls.filter((call) => call.url.includes("/api/check-for-updates")).at(-1);
    expect(failedManualCall?.url).toMatch(/\/api\/check-for-updates\?_ts=\d+/);
    expect(failedManualCall?.init?.cache).toBe("no-store");
  });

  it("shows a friendly message when manual check reports no update is available", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/update-status")) {
        return jsonResponse({ available: false, currentVersion: "1.2.78" });
      }

      if (url.includes("/api/check-for-updates")) {
        return jsonResponse({
          ok: true,
          available: false,
          latestVersion: "1.2.78",
          currentVersion: "1.2.78",
        });
      }

      if (url.includes("/api/updater-progress")) {
        return jsonResponse({ state: "idle", currentVersion: "1.2.78" });
      }

      if (url.includes("/api/updater-diagnostics")) {
        return jsonResponse({
          checkedAt: "2026-03-20T00:00:00.000Z",
          lastCheck: { ok: true, available: false },
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage onBack={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText("Current version:")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Check for Updates" }));

    await waitFor(() => {
      expect(screen.getByText("Already up to date. You're running v1.2.78.")).toBeInTheDocument();
    });
  });

  it("uses last known latest version when manual check fails due to timeout", async () => {
    let checkCallCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/update-status")) {
        return jsonResponse({ available: false, currentVersion: "1.3.2" });
      }

      if (url.includes("/api/check-for-updates")) {
        checkCallCount += 1;
        if (checkCallCount === 1) {
          return jsonResponse({
            ok: true,
            available: false,
            latestVersion: "1.3.2",
            currentVersion: "1.3.2",
          });
        }

        return jsonResponse({
          ok: false,
          available: false,
          currentVersion: "1.3.2",
          latestVersion: null,
          error: "Latest release request failed before receiving a response: The operation was aborted due to timeout",
        }, 502);
      }

      if (url.includes("/api/updater-progress")) {
        return jsonResponse({
          state: "idle",
          currentVersion: "1.3.2",
          latestVersion: "1.3.2",
          message: "No update found",
        });
      }

      if (url.includes("/api/updater-diagnostics")) {
        return jsonResponse({
          checkedAt: "2026-03-21T00:00:00.000Z",
          lastCheck: {
            ok: false,
            error: "Latest release request failed before receiving a response: The operation was aborted due to timeout",
          },
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage onBack={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText("Current version:")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Check for Updates" }));

    await waitFor(() => {
      expect(screen.getByText("Already up to date (latest confirmed: v1.3.2). You're running v1.3.2.")).toBeInTheDocument();
    });
  });

  it("shows up-to-date status when manual check throws Failed to fetch but progress confirms equal versions", async () => {
    let checkCallCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/update-status")) {
        return jsonResponse({ available: false, currentVersion: "1.4.5" });
      }

      if (url.includes("/api/check-for-updates")) {
        checkCallCount += 1;
        if (checkCallCount === 1) {
          return jsonResponse({
            ok: true,
            available: false,
            latestVersion: "1.4.5",
            currentVersion: "1.4.5",
          });
        }

        throw new TypeError("Failed to fetch");
      }

      if (url.includes("/api/updater-progress")) {
        return jsonResponse({
          state: "idle",
          currentVersion: "1.4.5",
          latestVersion: "1.4.5",
          message: "No update found",
        });
      }

      if (url.includes("/api/updater-diagnostics")) {
        return jsonResponse({
          checkedAt: "2026-03-21T00:00:00.000Z",
          lastCheck: {
            ok: true,
            available: false,
            currentVersion: "1.4.5",
            latestVersion: "1.4.5",
          },
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage onBack={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText("Current version:")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Check for Updates" }));

    await waitFor(() => {
      expect(screen.getByText("Already up to date (latest confirmed: v1.4.5). You're running v1.4.5.")).toBeInTheDocument();
    });
  });

  it("shows unified debug controls and token introspection in the Debug Log card", async () => {
    render(<SettingsPage onBack={() => undefined} />);

    const debugCard = screen.getByText("Debug Log").closest("article");
    expect(debugCard).not.toBeNull();

    expect(within(debugCard as HTMLElement).getByLabelText("Enable Debug Logging")).toBeInTheDocument();
    expect(within(debugCard as HTMLElement).getByRole("button", { name: "Clear Debug Log" })).toBeInTheDocument();
    expect(within(debugCard as HTMLElement).getByRole("button", { name: "Send Debug Log to Cloud" })).toBeInTheDocument();
    expect(within(debugCard as HTMLElement).getByText("Page: Settings")).toBeInTheDocument();
    expect(within(debugCard as HTMLElement).getByText("Card: Debug Log")).toBeInTheDocument();
    expect(within(debugCard as HTMLElement).getByText("Components: Enable Debug Logging, Clear Debug Log, Send Debug Log to Cloud, Token Introspection")).toBeInTheDocument();
    expect(within(debugCard as HTMLElement).getByText("MAJOR: #2563EB")).toBeInTheDocument();
    expect(within(debugCard as HTMLElement).getByText("Risk: No cascading token failures detected.")).toBeInTheDocument();
  });

  it("shows DSC as not installed by default and renders minimal settings", async () => {
    render(<SettingsPage onBack={() => undefined} />);

    const dscCard = (await screen.findByText("Design System Controls")).closest("article") as HTMLElement;
    expect(within(dscCard).getAllByText("Not Installed").length).toBeGreaterThan(0);
    expect(within(dscCard).getByText(/Install DSC to unlock advanced design controls/)).toBeInTheDocument();
    expect(within(dscCard).getByRole("button", { name: "Install DSC Module" })).toBeInTheDocument();
    expect(within(dscCard).queryByRole("button", { name: "Open DSC Module" })).not.toBeInTheDocument();
  });

  it("installs DSC from UI and opens the floating workspace", async () => {
    render(<SettingsPage onBack={() => undefined} />);

    const dscCard = (await screen.findByText("Design System Controls")).closest("article") as HTMLElement;
    fireEvent.click(within(dscCard).getByRole("button", { name: "Install DSC Module" }));

    await waitFor(() => {
      expect(within(dscCard).getAllByText("Installed").length).toBeGreaterThan(0);
      expect(within(dscCard).getByRole("button", { name: "Open DSC Module" })).toBeInTheDocument();
      expect(within(dscCard).getByRole("button", { name: "Uninstall DSC Module" })).toBeInTheDocument();
    });

    fireEvent.click(within(dscCard).getByRole("button", { name: "Open DSC Module" }));

    const floatingCard = await screen.findByRole("dialog", { name: "Design System Controls" });
    expect(floatingCard).toHaveAttribute("data-floating-layer", "highest");
    expect(floatingCard).toHaveAttribute("data-clip-root", "viewport");
    expect(within(floatingCard).getByText(/Gamma:/)).toBeInTheDocument();
    expect(within(floatingCard).getByText("Stroke preset")).toBeInTheDocument();
    expect(within(floatingCard).getByText("Directional flow")).toBeInTheDocument();
    expect(within(floatingCard).getByText("Buttons & Cards")).toBeInTheDocument();
    expect(within(floatingCard).getByText("Save mode")).toBeInTheDocument();
    expect(within(floatingCard).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(floatingCard).getByRole("button", { name: "Use System Defaults" })).toBeInTheDocument();
  });

  it("supports floating DSC card move-and-close lifecycle from settings", async () => {
    render(<SettingsPage onBack={() => undefined} />);

    const dscCard = (await screen.findByText("Design System Controls")).closest("article") as HTMLElement;
    fireEvent.click(within(dscCard).getByRole("button", { name: "Install DSC Module" }));
    await waitFor(() => expect(within(dscCard).getByRole("button", { name: "Open DSC Module" })).toBeInTheDocument());
    fireEvent.click(within(dscCard).getByRole("button", { name: "Open DSC Module" }));

    const floatingCard = await screen.findByRole("dialog", { name: "Design System Controls" });
    const initialLeft = floatingCard.style.left;
    const initialTop = floatingCard.style.top;
    const header = floatingCard.querySelector(".dsc-floating-card__header");
    expect(header).not.toBeNull();

    await act(async () => {
      fireEvent.mouseDown(header as Element, { button: 0, clientX: 180, clientY: 120 });
    });

    await act(async () => {
      await Promise.resolve();
      fireEvent.mouseMove(window, { clientX: 260, clientY: 190 });
      fireEvent.mouseUp(window);
    });

    expect(floatingCard.style.left).not.toBe(initialLeft);
    expect(floatingCard.style.top).not.toBe(initialTop);

    fireEvent.click(within(floatingCard).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Design System Controls" })).not.toBeInTheDocument();
    });
  });

  it("uninstalls DSC from UI and returns to minimal settings", async () => {
    render(<SettingsPage onBack={() => undefined} />);

    const dscCard = (await screen.findByText("Design System Controls")).closest("article") as HTMLElement;
    fireEvent.click(within(dscCard).getByRole("button", { name: "Install DSC Module" }));
    await waitFor(() => expect(within(dscCard).getByRole("button", { name: "Uninstall DSC Module" })).toBeInTheDocument());

    fireEvent.click(within(dscCard).getByRole("button", { name: "Uninstall DSC Module" }));

    await waitFor(() => {
      expect(within(dscCard).getAllByText("Not Installed").length).toBeGreaterThan(0);
      expect(within(dscCard).getByRole("button", { name: "Install DSC Module" })).toBeInTheDocument();
      expect(within(dscCard).queryByRole("button", { name: "Open DSC Module" })).not.toBeInTheDocument();
    });
  });
});