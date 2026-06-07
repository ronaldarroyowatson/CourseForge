import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  getNodeOcrSettingsManager,
  validateOcrSettings,
} from "../../src/core/services/ocrSettingsService";

describe("ocrSettingsService", () => {
  beforeAll(() => {
    const tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-ocr-settings-service-"));
    process.env.LOCALAPPDATA = tempLocalAppData;
  });

  it("clamps and normalizes invalid values", () => {
    const normalized = validateOcrSettings({
      maxRetryAttempts: 99,
      shots: 9,
      dynamicLimitBufferSeconds: -5,
      cropStrategy: "both",
      debugLevel: "trace",
      fallbackBehavior: "wait",
      primaryProvider: "cloud_openai_vision",
    });

    expect(normalized.maxRetryAttempts).toBe(10);
    expect(normalized.shots).toBe(3);
    expect(normalized.dynamicLimitBufferSeconds).toBe(0);
    expect(normalized.cropStrategy).toBe("both");
    expect(normalized.debugLevel).toBe("trace");
  });

  it("emits runtime options from persisted settings", async () => {
    const manager = await getNodeOcrSettingsManager();
    await manager.resetSettings();
    await manager.updateSettings({
      primaryProvider: "cloud_github_models_vision",
      fallbackBehavior: "wait",
      dynamicRateLimitAdaptation: true,
      dynamicLimitBufferSeconds: 5,
    });

    const runtime = await manager.getRuntimeOptions();
    expect(runtime.providerOrder[0]).toBe("cloud_github_models_vision");
    expect(runtime.providerOrder).toEqual(["cloud_github_models_vision", "cloud_openai_vision", "local_tesseract"]);
    expect(runtime.preferPrimaryCloudWait).toBe(true);
    expect(runtime.waitForPrimaryCloudCooldownMs).toBeGreaterThanOrEqual(50_000);
    expect(runtime.maxPrimaryCloudWaitMs).toBeGreaterThan(runtime.waitForPrimaryCloudCooldownMs);
  });
});
