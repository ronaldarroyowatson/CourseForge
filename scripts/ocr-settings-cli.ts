import fs from "node:fs";
import path from "node:path";

import {
  getNodeOcrSettingsManager,
  type OcrSettingsUpdateInput,
  type OcrSettings,
} from "../src/core/services/ocrSettingsService";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function toBoolean(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return undefined;
}

function toInteger(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function normalizePrimaryProvider(value: string | boolean | undefined): OcrSettings["primaryProvider"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "openai" || normalized === "cloud_openai_vision") {
    return "cloud_openai_vision";
  }
  if (normalized === "github" || normalized === "cloud_github_models_vision") {
    return "cloud_github_models_vision";
  }

  return undefined;
}

function normalizeFallback(value: string | boolean | undefined): OcrSettings["fallbackBehavior"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "wait") {
    return "wait";
  }
  if (normalized === "backup") {
    return "backup";
  }
  if (normalized === "tesseract-last") {
    return "tesseract-last";
  }

  return undefined;
}

function normalizeCropStrategy(value: string | boolean | undefined): OcrSettings["cropStrategy"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "color") {
    return "color";
  }
  if (normalized === "bw") {
    return "bw";
  }
  if (normalized === "both") {
    return "both";
  }

  return undefined;
}

function normalizeDebugLevel(value: string | boolean | undefined): OcrSettings["debugLevel"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "off") {
    return "off";
  }
  if (normalized === "errors" || normalized === "errors-only") {
    return "errors";
  }
  if (normalized === "verbose") {
    return "verbose";
  }
  if (normalized === "trace" || normalized === "full" || normalized === "full-trace") {
    return "trace";
  }

  return undefined;
}

function printHuman(settings: OcrSettings): void {
  console.log("OCR Settings");
  console.log(`  - Auto-retries enabled: ${settings.autoRetriesEnabled}`);
  console.log(`  - Max retry attempts: ${settings.maxRetryAttempts}`);
  console.log(`  - Shots: ${settings.shots}`);
  console.log(`  - Crop strategy: ${settings.cropStrategy}`);
  console.log(`  - Dynamic rate-limit adaptation: ${settings.dynamicRateLimitAdaptation}`);
  console.log(`  - Dynamic limit buffer (seconds): ${settings.dynamicLimitBufferSeconds}`);
  console.log(`  - Primary provider: ${settings.primaryProvider}`);
  console.log(`  - Fallback behavior: ${settings.fallbackBehavior}`);
  console.log(`  - Debug level: ${settings.debugLevel}`);
}

function printJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload, null, 2));
}

async function main(): Promise<void> {
  const action = (process.argv[2] ?? "get").toLowerCase();
  const flags = parseArgs(process.argv.slice(3));
  const emitJson = flags.json === true;
  const manager = await getNodeOcrSettingsManager();

  if (action === "get" || action === "show") {
    const settings = await manager.getSettings();
    if (emitJson) {
      printJson({ ok: true, action, settings });
      return;
    }

    printHuman(settings);
    return;
  }

  if (action === "reset") {
    const settings = await manager.resetSettings();
    if (emitJson) {
      printJson({ ok: true, action, settings });
      return;
    }

    console.log("OCR settings reset to defaults.");
    printHuman(settings);
    return;
  }

  if (action === "set") {
    const update: OcrSettingsUpdateInput = {};

    const autoRetries = toBoolean(flags["auto-retries"]);
    if (typeof autoRetries === "boolean") {
      update.autoRetriesEnabled = autoRetries;
    }

    const maxRetries = toInteger(flags["max-retries"]);
    if (typeof maxRetries === "number") {
      update.maxRetryAttempts = maxRetries;
    }

    const shots = toInteger(flags.shots);
    if (typeof shots === "number") {
      update.shots = shots;
    }

    const cropStrategy = normalizeCropStrategy(flags["crop-strategy"]);
    if (cropStrategy) {
      update.cropStrategy = cropStrategy;
    }

    const dynamicLimits = toBoolean(flags["dynamic-limits"]);
    if (typeof dynamicLimits === "boolean") {
      update.dynamicRateLimitAdaptation = dynamicLimits;
    }

    const limitBuffer = toInteger(flags["limit-buffer"]);
    if (typeof limitBuffer === "number") {
      update.dynamicLimitBufferSeconds = limitBuffer;
    }

    const primaryProvider = normalizePrimaryProvider(flags["primary-provider"]);
    if (primaryProvider) {
      update.primaryProvider = primaryProvider;
    }

    const fallbackBehavior = normalizeFallback(flags.fallback);
    if (fallbackBehavior) {
      update.fallbackBehavior = fallbackBehavior;
    }

    const debugLevel = normalizeDebugLevel(flags["debug-level"]);
    if (debugLevel) {
      update.debugLevel = debugLevel;
    }

    if (Object.keys(update).length === 0) {
      console.error("No valid settings provided. Use flags like --auto-retries, --max-retries, --shots, --crop-strategy, --dynamic-limits, --limit-buffer, --primary-provider, --fallback, --debug-level.");
      process.exit(1);
    }

    const settings = await manager.updateSettings(update);
    if (emitJson) {
      printJson({ ok: true, action, settings });
      return;
    }

    console.log("OCR settings updated.");
    printHuman(settings);
    return;
  }

  if (action === "export") {
    const content = await manager.exportSettings();
    const outputPath = typeof flags.output === "string" ? flags.output.trim() : "";
    if (outputPath) {
      const resolved = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, `${content}\n`, "utf8");
      if (emitJson) {
        printJson({ ok: true, action, outputPath: resolved });
      } else {
        console.log(`Exported OCR settings to ${resolved}`);
      }
      return;
    }

    if (emitJson) {
      printJson({ ok: true, action, settings: JSON.parse(content) as Record<string, unknown> });
      return;
    }

    console.log(content);
    return;
  }

  if (action === "import") {
    const inputPath = typeof flags.input === "string" ? flags.input.trim() : "";
    if (!inputPath) {
      console.error("Missing required flag: --input <path>");
      process.exit(1);
    }

    const resolved = path.resolve(inputPath);
    if (!fs.existsSync(resolved)) {
      console.error(`Settings file not found: ${resolved}`);
      process.exit(1);
    }

    const raw = fs.readFileSync(resolved, "utf8");
    const settings = await manager.importSettings(raw);
    if (emitJson) {
      printJson({ ok: true, action, settings, inputPath: resolved });
      return;
    }

    console.log(`Imported OCR settings from ${resolved}`);
    printHuman(settings);
    return;
  }

  if (action === "reset-circuit") {
    const circuitKey = "courseforge.autoOcr.circuitState";
    const pacingKey = "courseforge.autoOcr.cloudRequestPacing";
    const nodeDataDir = path.resolve(".courseforge-ocr-state");
    const circuitFile = path.join(nodeDataDir, "circuitState.json");
    const pacingFile = path.join(nodeDataDir, "cloudRequestPacing.json");
    const cleared: string[] = [];

    if (fs.existsSync(circuitFile)) {
      fs.rmSync(circuitFile);
      cleared.push(circuitFile);
    }

    if (fs.existsSync(pacingFile)) {
      fs.rmSync(pacingFile);
      cleared.push(pacingFile);
    }

    if (emitJson) {
      printJson({ ok: true, action, clearedFiles: cleared, note: "In-browser localStorage keys cleared on next app page load." });
      return;
    }

    console.log("Cloud OCR circuit breaker and pacing state cleared (node files).");
    if (cleared.length > 0) {
      cleared.forEach((filePath) => console.log(`  Removed: ${filePath}`));
    }

    console.log(`\nNote: Browser state (localStorage keys '${circuitKey}', '${pacingKey}') is cleared by the GUI 'Reset Cloud OCR Circuit Breakers' button in Settings > OCR Settings.`);
    return;
  }

  console.error("Unknown OCR settings action. Use get, set, reset, show, export, import, or reset-circuit.");
  process.exit(1);
}

void main();
