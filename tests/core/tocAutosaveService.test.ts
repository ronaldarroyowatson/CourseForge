import { describe, expect, it, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import type { ParsedTocResult } from "../../src/core/services/textbookAutoExtractionService";
import {
  initializeTocAutosave,
  autosaveToc,
  restoreTocAutosave,
  clearTocAutosave,
  listTocAutosaves,
  cancelPendingAutosave,
} from "../../src/core/services/tocAutosaveService";

async function waitForAutosaveDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1700));
}

describe("tocAutosaveService", () => {
  const mockTocResult: ParsedTocResult = {
    chapters: [
      {
        chapterNumber: "1",
        title: "Introduction",
        chapterLabel: "Chapter",
        sections: [],
      },
      {
        chapterNumber: "2",
        title: "Methods",
        chapterLabel: "Chapter",
        sections: [
          {
            sectionNumber: "2.1",
            title: "First Method",
            pageStart: 25,
          },
        ],
      },
    ],
    confidence: 0.85,
  };

  const mockTocPages = [
    {
      pageIndex: 0,
      chapters: mockTocResult.chapters,
      confidence: mockTocResult.confidence,
    },
  ];

  beforeEach(() => {
    vi.useRealTimers();
  });

  it("initializes the autosave system without errors", async () => {
    await expect(initializeTocAutosave()).resolves.toBeUndefined();
  });

  it("autosaves TOC data after debounce delay", async () => {
    const sessionId = "test-session-123";
    await initializeTocAutosave();

    // Trigger autosave
    autosaveToc(sessionId, "draft-1", mockTocResult, mockTocPages);

    await waitForAutosaveDebounce();

    // Restore and verify
    const restored = await restoreTocAutosave(sessionId);
    expect(restored).toBeDefined();
    expect(restored?.sessionId).toBe(sessionId);
    expect(restored?.tocResult.chapters).toHaveLength(2);
    expect(restored?.tocResult.confidence).toBe(0.85);
  });

  it("debounces multiple autosave calls and only saves the latest", async () => {
    const sessionId = "test-session-debounce";
    await initializeTocAutosave();

    // Trigger multiple autosave calls
    autosaveToc(sessionId, "draft-1", mockTocResult, mockTocPages);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const modifiedResult: ParsedTocResult = {
      ...mockTocResult,
      chapters: [
        ...mockTocResult.chapters,
        {
          chapterNumber: "3",
          title: "Results",
          chapterLabel: "Chapter",
          sections: [],
        },
      ],
    };

    autosaveToc(sessionId, "draft-1", modifiedResult, mockTocPages);
    await waitForAutosaveDebounce();

    const restored = await restoreTocAutosave(sessionId);
    expect(restored?.tocResult.chapters).toHaveLength(3); // Should have the modified version
  });

  it("stores autosave with correct metadata", async () => {
    const sessionId = "test-session-metadata";
    await initializeTocAutosave();

    autosaveToc(sessionId, "draft-abc", mockTocResult, mockTocPages);
    await waitForAutosaveDebounce();

    const restored = await restoreTocAutosave(sessionId);
    expect(restored?.draftId).toBe("draft-abc");
    expect(restored?.lastSavedAt).toBeDefined();
    // lastSavedAt should be a valid ISO string
    expect(() => new Date(restored?.lastSavedAt ?? "")).not.toThrow();
  });

  it("returns null when restoring non-existent autosave", async () => {
    await initializeTocAutosave();
    const restored = await restoreTocAutosave("non-existent-session");
    expect(restored).toBeNull();
  });

  it("clears autosave for a session", async () => {
    const sessionId = "test-session-clear";
    await initializeTocAutosave();

    autosaveToc(sessionId, "draft-1", mockTocResult, mockTocPages);
    await waitForAutosaveDebounce();

    // Verify it exists
    let restored = await restoreTocAutosave(sessionId);
    expect(restored).toBeDefined();

    // Clear it
    await clearTocAutosave(sessionId);

    // Verify it's gone
    restored = await restoreTocAutosave(sessionId);
    expect(restored).toBeNull();
  });

  it("lists all autosaves in reverse chronological order", async () => {
    await initializeTocAutosave();

    // Create multiple autosaves
    autosaveToc("session-1", "draft-1", mockTocResult, mockTocPages);
    await waitForAutosaveDebounce();

    await new Promise((resolve) => setTimeout(resolve, 100));

    autosaveToc("session-2", "draft-2", mockTocResult, mockTocPages);
    await waitForAutosaveDebounce();

    const autosaves = await listTocAutosaves();
    expect(autosaves.length).toBeGreaterThanOrEqual(2);

    // Verify they're sorted by lastSavedAt (most recent first)
    if (autosaves.length >= 2) {
      const first = new Date(autosaves[0].lastSavedAt);
      const second = new Date(autosaves[1].lastSavedAt);
      expect(first.getTime()).toBeGreaterThanOrEqual(second.getTime());
    }
  });

  it("cancels pending autosave on unmount", async () => {
    const sessionId = "test-session-cancel";
    await initializeTocAutosave();

    autosaveToc(sessionId, "draft-1", mockTocResult, mockTocPages);
    await new Promise((resolve) => setTimeout(resolve, 500)); // Partial debounce delay

    cancelPendingAutosave();
    await new Promise((resolve) => setTimeout(resolve, 1200)); // Complete the remaining time

    // The autosave should have been canceled
    const restored = await restoreTocAutosave(sessionId);
    // If properly canceled, nothing should be saved
    // Note: This test checks that the cancel function runs without error
    expect(restored).toBeNull();
  });

  it("handles empty chapters in autosave", async () => {
    const sessionId = "test-session-empty";
    await initializeTocAutosave();

    const emptyResult: ParsedTocResult = {
      chapters: [],
      confidence: 0,
    };

    autosaveToc(sessionId, "draft-1", emptyResult, []);
    await waitForAutosaveDebounce();

    // Even empty TOCs should be saveable
    const restored = await restoreTocAutosave(sessionId);
    expect(restored?.tocResult.chapters).toHaveLength(0);
  });

  it("handles units in autosave", async () => {
    const sessionId = "test-session-units";
    await initializeTocAutosave();

    const resultWithUnits: ParsedTocResult = {
      chapters: mockTocResult.chapters,
      units: [
        {
          unitNumber: "1",
          title: "Unit 1: Basics",
          chapters: mockTocResult.chapters,
        },
      ],
      confidence: 0.85,
    };

    autosaveToc(sessionId, "draft-1", resultWithUnits, mockTocPages);
    await waitForAutosaveDebounce();

    const restored = await restoreTocAutosave(sessionId);
    expect(restored?.tocResult.units).toHaveLength(1);
    expect(restored?.tocResult.units?.[0].unitNumber).toBe("1");
  });
});
