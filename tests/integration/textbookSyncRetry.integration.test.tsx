import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Textbook } from "../../src/core/models";
import { TextbookList } from "../../src/webapp/components/textbooks/TextbookList";

type SyncNowResult = {
  success: boolean;
  message: string;
  retryable: boolean;
  permissionDenied: boolean;
  throttled: boolean;
  writeLoopTriggered: boolean;
  writeBudgetExceeded: boolean;
  writeCount: number;
  writeBudgetLimit: number;
  readCount: number;
  readBudgetLimit: number;
  readBudgetExceeded: boolean;
  retryLimit: number;
  errorCode: string | null;
  pendingCount: number;
};

const syncNowMock = vi.hoisted(() => vi.fn<() => Promise<SyncNowResult>>());

const repositoriesMock = vi.hoisted(() => ({
  removeTextbook: vi.fn(async () => undefined),
  toggleTextbookFavorite: vi.fn(async () => undefined),
  toggleTextbookArchive: vi.fn(async () => undefined),
}));

const uiStoreMock = vi.hoisted(() => ({
  setSelectedTextbook: vi.fn(),
}));

vi.mock("../../src/core/services/syncService", () => ({
  syncNow: syncNowMock,
  getPendingSyncDiagnostics: vi.fn(async () => ({
    pendingCount: 1,
    byStore: {
      textbooks: 1,
      chapters: 0,
      sections: 0,
      vocabTerms: 0,
      equations: 0,
      concepts: 0,
      keyIdeas: 0,
    },
  })),
  getSyncWriteBatchLimit: vi.fn(() => 120),
  getSyncThrottleWindowMs: vi.fn(() => 5000),
}));

vi.mock("../../src/webapp/hooks/useRepositories", () => ({
  useRepositories: () => repositoriesMock,
}));

vi.mock("../../src/webapp/store/uiStore", () => ({
  useUIStore: () => uiStoreMock,
}));

function buildTextbook(overrides: Partial<Textbook> = {}): Textbook {
  const timestamp = "2026-04-29T00:00:00.000Z";

  return {
    id: "tb-1",
    sourceType: "auto",
    originalLanguage: "en",
    title: "Inspire Physical Science",
    subtitle: "with Earth Science",
    grade: "Pre-K-12",
    gradeBand: "Pre-K-12",
    subject: "Science",
    edition: "1",
    publicationYear: 2021,
    isbnRaw: "9780076716852",
    isbnNormalized: "9780076716852",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
    isFavorite: false,
    isArchived: false,
    ...overrides,
  };
}

function buildSyncResult(overrides: Partial<SyncNowResult> = {}): SyncNowResult {
  return {
    success: true,
    message: "Sync completed successfully.",
    retryable: false,
    permissionDenied: false,
    throttled: false,
    writeLoopTriggered: false,
    writeBudgetExceeded: false,
    writeCount: 0,
    writeBudgetLimit: 500,
    readCount: 0,
    readBudgetLimit: 5000,
    readBudgetExceeded: false,
    retryLimit: 3,
    errorCode: null,
    pendingCount: 0,
    ...overrides,
  };
}

describe("textbook retry sync metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("shows upload progress metrics while retry sync is running and after completion", async () => {
    let resolveSync!: (value: SyncNowResult) => void;
    const deferredSync = new Promise<SyncNowResult>((resolve) => {
      resolveSync = resolve;
    });
    syncNowMock.mockImplementation(() => deferredSync);

    const onRefresh = vi.fn();

    render(
      <TextbookList
        textbooks={[buildTextbook()]}
        isLoading={false}
        loadError={null}
        selectedTextbookId={null}
        onSelectTextbook={() => undefined}
        onContinueToSections={() => undefined}
        onDeleted={() => undefined}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry cloud sync" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Retry Sync Progress: (8% - Preparing retry...|32% - Starting cloud sync attempt...)/i)
      ).toBeInTheDocument();
    });

    resolveSync(buildSyncResult({ success: true, pendingCount: 0 }));

    await waitFor(() => {
      expect(screen.getByText(/Retry Sync Progress: 100% - Upload complete\./i)).toBeInTheDocument();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("auto-retries after throttling and completes once the sync window opens", async () => {
    syncNowMock
      .mockResolvedValueOnce(
        buildSyncResult({
          success: false,
          throttled: true,
          message: "Sync skipped to avoid excessive write frequency.",
          pendingCount: 1,
        })
      )
      .mockResolvedValueOnce(
        buildSyncResult({
          success: true,
          pendingCount: 0,
        })
      );

    render(
      <TextbookList
        textbooks={[buildTextbook()]}
        isLoading={false}
        loadError={null}
        selectedTextbookId={null}
        onSelectTextbook={() => undefined}
        onContinueToSections={() => undefined}
        onDeleted={() => undefined}
        onRefresh={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry cloud sync" }));

    await waitFor(() => {
      expect(screen.getByText(/Retry Sync Progress: \d+% - Upload queued\. Waiting for sync window\./i)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(syncNowMock).toHaveBeenCalledTimes(2);
    }, { timeout: 8000 });

    await waitFor(() => {
      expect(screen.getByText(/Retry Sync Progress: 100% - Upload complete\./i)).toBeInTheDocument();
    }, { timeout: 8000 });
  });
});
