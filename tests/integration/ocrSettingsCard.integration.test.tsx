import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadModules() {
  const cardModule = await import("../../src/webapp/components/settings/OcrSettingsCard");
  const settingsModule = await import("../../src/core/services/ocrSettingsService");
  const parityModule = await import("../../src/core/services/guiCliParityService");

  return {
    OcrSettingsCard: cardModule.OcrSettingsCard,
    getBrowserOcrSettingsManager: settingsModule.getBrowserOcrSettingsManager,
    getLiveDefaultOcrSettings: settingsModule.getLiveDefaultOcrSettings,
    getGuiCliParityHistoryEntries: parityModule.getGuiCliParityHistoryEntries,
    clearGuiCliParityHistoryEntries: parityModule.clearGuiCliParityHistoryEntries,
  };
}

describe("OcrSettingsCard integration", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it("updates shared OCR settings and runtime provider order from panel controls", async () => {
    const {
      OcrSettingsCard,
      getBrowserOcrSettingsManager,
      getGuiCliParityHistoryEntries,
      clearGuiCliParityHistoryEntries,
    } = await loadModules();

    clearGuiCliParityHistoryEntries();

    render(<OcrSettingsCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Show" }));

    fireEvent.change(screen.getByLabelText(/Primary OCR Provider/i), {
      target: { value: "cloud_github_models_vision" },
    });
    await waitFor(async () => {
      const settings = await (await getBrowserOcrSettingsManager()).getSettings();
      expect(settings.primaryProvider).toBe("cloud_github_models_vision");
    });

    fireEvent.change(screen.getByLabelText(/Fallback Behavior/i), {
      target: { value: "wait" },
    });
    await waitFor(async () => {
      const settings = await (await getBrowserOcrSettingsManager()).getSettings();
      expect(settings.fallbackBehavior).toBe("wait");
    });

    fireEvent.change(screen.getByLabelText(/Number of Shots \/ Captures/i), {
      target: { value: "1" },
    });

    const manager = await getBrowserOcrSettingsManager();

    await waitFor(async () => {
      const settings = await manager.getSettings();
      expect(settings.primaryProvider).toBe("cloud_github_models_vision");
      expect(settings.fallbackBehavior).toBe("wait");
      expect(settings.shots).toBe(1);
    });

    const runtime = await manager.getRuntimeOptions();
    expect(runtime.providerOrder).toEqual(["cloud_github_models_vision", "cloud_openai_vision", "local_tesseract"]);
    expect(runtime.preferPrimaryCloudWait).toBe(true);

    const commandIds = getGuiCliParityHistoryEntries().map((entry) => entry.commandId);
    expect(commandIds).toContain("courseforge ocr settings set --primary-provider github");
    expect(commandIds).toContain("courseforge ocr settings set --fallback wait");
    expect(commandIds).toContain("courseforge ocr settings set --shots 1");
  });

  it("starts from live defaults and applies retry/rate-limit settings via panel", async () => {
    const {
      OcrSettingsCard,
      getBrowserOcrSettingsManager,
      getLiveDefaultOcrSettings,
      getGuiCliParityHistoryEntries,
      clearGuiCliParityHistoryEntries,
    } = await loadModules();

    clearGuiCliParityHistoryEntries();

    render(<OcrSettingsCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Show" }));

    const defaults = getLiveDefaultOcrSettings();
    expect(screen.getByLabelText(/Auto-Retries Enabled/i)).toBeChecked();
    expect(Number((screen.getByLabelText(/Dynamic Limit Buffer \(seconds\)/i) as HTMLInputElement).value)).toBe(defaults.dynamicLimitBufferSeconds);

    fireEvent.click(screen.getByLabelText(/Auto-Retries Enabled/i));
    await waitFor(async () => {
      const settings = await (await getBrowserOcrSettingsManager()).getSettings();
      expect(settings.autoRetriesEnabled).toBe(false);
    });

    fireEvent.change(screen.getByLabelText(/Max Retry Attempts/i), {
      target: { value: "4" },
    });
    await waitFor(async () => {
      const settings = await (await getBrowserOcrSettingsManager()).getSettings();
      expect(settings.maxRetryAttempts).toBe(4);
    });

    fireEvent.change(screen.getByLabelText(/Dynamic Limit Buffer \(seconds\)/i), {
      target: { value: "9" },
    });

    const manager = await getBrowserOcrSettingsManager();

    await waitFor(async () => {
      const settings = await manager.getSettings();
      expect(settings.autoRetriesEnabled).toBe(false);
      expect(settings.maxRetryAttempts).toBe(4);
      expect(settings.dynamicLimitBufferSeconds).toBe(9);
    });

    const runtime = await manager.getRuntimeOptions();
    expect(runtime.waitForPrimaryCloudCooldownMs).toBe(54_000);

    const commandIds = getGuiCliParityHistoryEntries().map((entry) => entry.commandId);
    expect(commandIds).toContain("courseforge ocr settings set --auto-retries false");
    expect(commandIds).toContain("courseforge ocr settings set --max-retries 4");
    expect(commandIds).toContain("courseforge ocr settings set --limit-buffer 9");
  });
});
