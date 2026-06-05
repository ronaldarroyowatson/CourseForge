import { describe, expect, it, vi } from "vitest";

import { clearGuiCliParityHistoryEntries, executeGuiCliBoundCommand, getGuiCliParityHistoryEntries } from "../../src/core/services/guiCliParityService";

describe("gui cli parity service", () => {
  it("records successful bound command executions", async () => {
    clearGuiCliParityHistoryEntries();

    const result = await executeGuiCliBoundCommand("courseforge settings language set", async () => "ok", {
      language: "en",
    });

    expect(result).toBe("ok");
    const entries = getGuiCliParityHistoryEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]).toEqual(expect.objectContaining({
      commandId: "courseforge settings language set",
      ok: true,
    }));
  });

  it("records failed bound command executions", async () => {
    clearGuiCliParityHistoryEntries();

    await expect(executeGuiCliBoundCommand("courseforge admin moderation approve", async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");

    const entries = getGuiCliParityHistoryEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]).toEqual(expect.objectContaining({
      commandId: "courseforge admin moderation approve",
      ok: false,
    }));
  });

  it("passes action context through and executes callback exactly once", async () => {
    clearGuiCliParityHistoryEntries();

    const callback = vi.fn(async () => 42);
    const result = await executeGuiCliBoundCommand("courseforge textbooks save", callback, { sourceType: "manual" });

    expect(result).toBe(42);
    expect(callback).toHaveBeenCalledTimes(1);
    const entries = getGuiCliParityHistoryEntries();
    expect(entries[0]?.context).toEqual(expect.objectContaining({ sourceType: "manual" }));
  });
});
