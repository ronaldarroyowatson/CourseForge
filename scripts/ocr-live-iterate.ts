import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

interface IterationRecord {
  iteration: number;
  providerMode: "cloud" | "local";
  reportFile: string;
  providerId?: string;
  cerStructured?: number;
  cerRaw?: number;
  confidence?: number;
  selectedVariant?: string;
  attempts?: Array<{ providerId: string; success: boolean; errorMessage?: string }>;
  cooldownTriggered?: boolean;
  error?: string;
}

interface OcrDebugReport {
  generatedAt: string;
  providerId: string;
  attempts: Array<{ providerId: string; success: boolean; errorMessage?: string }>;
  parsedToc: { confidence: number; chapters: Array<{ sections: unknown[] }> };
  cerRaw?: number;
  cerStructured?: number;
  selectedVariant?: string;
}

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCloudCooldownFailure(errorMessage: string): boolean {
  return /(429|rate\s*limit|throttl|quota|too\s*many\s*requests|capacity|temporarily\s*unavailable)/i.test(errorMessage);
}

function runDebugCommand(args: string[]): void {
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(npxCommand, ["tsx", "scripts/ocr-live-debug.ts", ...args], {
    cwd: process.cwd(),
    stdio: "pipe",
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function readReport(reportFile: string): OcrDebugReport {
  return JSON.parse(fs.readFileSync(reportFile, "utf8")) as OcrDebugReport;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const imageFile = typeof args["image-file"] === "string" ? args["image-file"] : "";
  const requestedGoldTranscriptFile = typeof args["gold-transcript-file"] === "string" ? args["gold-transcript-file"] : "";
  const iterations = Math.max(1, Number(typeof args.iterations === "string" ? args.iterations : "8") || 8);
  const cloudProvider = typeof args["cloud-provider"] === "string" ? args["cloud-provider"].trim() : "cloud_openai_vision";
  const reportDir = path.resolve(typeof args["report-dir"] === "string" ? args["report-dir"] : "tmp-smoke/live-iteration");
  const logFile = path.resolve(typeof args["log-file"] === "string" ? args["log-file"] : "docs/ocr-live-iteration-log.md");
  const cloudCooldownSeconds = Math.max(10, Number(typeof args["cloud-cooldown-seconds"] === "string" ? args["cloud-cooldown-seconds"] : "180") || 180);
  const betweenRunsSeconds = Math.max(1, Number(typeof args["between-runs-seconds"] === "string" ? args["between-runs-seconds"] : "8") || 8);
  const cerThreshold = typeof args["cer-threshold"] === "string" ? args["cer-threshold"] : "0.1";
  const structuredProfile = typeof args["structured-profile"] === "string" ? args["structured-profile"] : "toc-page1";
  const waitForPrimary = Boolean(args["wait-for-primary"]);
  const traceAll = Boolean(args["trace-all"]);
  const maxCrops = typeof args["max-crops"] === "string" ? Math.max(1, Number(args["max-crops"]) || 0) : 0;

  const goldTranscriptFile = requestedGoldTranscriptFile && fs.existsSync(path.resolve(requestedGoldTranscriptFile))
    ? requestedGoldTranscriptFile
    : "";

  if (requestedGoldTranscriptFile && !goldTranscriptFile) {
    console.warn(`[ocr-live-iterate] gold transcript not found at ${requestedGoldTranscriptFile}; continuing without CER comparison`);
  }

  if (!imageFile) {
    console.error("Missing required flag: --image-file");
    process.exit(1);
  }

  fs.mkdirSync(reportDir, { recursive: true });

  const records: IterationRecord[] = [];
  let nextCloudReadyAt = 0;
  let preferredMode: "cloud" | "local" = "cloud";

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const now = Date.now();
    const providerMode: "cloud" | "local" = preferredMode === "cloud" && now < nextCloudReadyAt
      ? "local"
      : preferredMode;

    preferredMode = preferredMode === "cloud" ? "local" : "cloud";

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportFile = path.join(reportDir, `${stamp}-iter-${String(iteration).padStart(2, "0")}-${providerMode}.json`);
    const runLabel = `iter-${String(iteration).padStart(2, "0")}-${providerMode}`;

    const debugArgs = [
      "--image-file", imageFile,
      "--output", reportFile,
      "--structured-profile", structuredProfile,
      "--cer-threshold", cerThreshold,
      "--run-label", runLabel,
      "--append-markdown-log", logFile,
      "--toc-focused", "true",
    ];

    if (goldTranscriptFile) {
      debugArgs.push("--gold-transcript-file", goldTranscriptFile);
    }

    if (providerMode === "cloud") {
      debugArgs.push("--direct-cloud-provider", cloudProvider);
    } else {
      debugArgs.push("--provider-order", "local_tesseract");
    }

    if (waitForPrimary) {
      debugArgs.push("--wait-for-primary");
    }

    if (traceAll) {
      debugArgs.push("--trace-all");
    }

    if (maxCrops > 0) {
      debugArgs.push("--max-crops", String(maxCrops));
    }

    const record: IterationRecord = {
      iteration,
      providerMode,
      reportFile,
    };

    try {
      runDebugCommand(debugArgs);
      const report = readReport(reportFile);
      const sectionCount = report.parsedToc.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0);

      record.providerId = report.providerId;
      record.cerStructured = report.cerStructured;
      record.cerRaw = report.cerRaw;
      record.confidence = report.parsedToc.confidence;
      record.selectedVariant = report.selectedVariant;
      record.attempts = report.attempts;

      const cloudFailureMessage = report.attempts
        .filter((attempt) => !attempt.success)
        .map((attempt) => attempt.errorMessage ?? "")
        .find((message) => isCloudCooldownFailure(message));

      if (providerMode === "cloud" && cloudFailureMessage) {
        nextCloudReadyAt = Date.now() + (cloudCooldownSeconds * 1000);
        record.cooldownTriggered = true;
      }

      console.log(`[ocr-live-iterate] iteration ${iteration}/${iterations} provider=${providerMode} selectedVariant=${report.selectedVariant ?? "n/a"} confidence=${report.parsedToc.confidence.toFixed(3)} sections=${sectionCount} cerStructured=${typeof report.cerStructured === "number" ? report.cerStructured.toFixed(4) : "n/a"}`);
      if (record.cooldownTriggered) {
        const waitSeconds = Math.ceil((nextCloudReadyAt - Date.now()) / 1000);
        console.log(`[ocr-live-iterate] cloud cooldown triggered, delaying cloud attempts for ${waitSeconds}s`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record.error = message;
      if (providerMode === "cloud" && isCloudCooldownFailure(message)) {
        nextCloudReadyAt = Date.now() + (cloudCooldownSeconds * 1000);
        record.cooldownTriggered = true;
      }
      console.error(`[ocr-live-iterate] iteration ${iteration}/${iterations} failed: ${message}`);
    }

    records.push(record);

    if (iteration < iterations) {
      await delay(betweenRunsSeconds * 1000);
    }
  }

  const summaryPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-summary.json`);
  fs.writeFileSync(summaryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    imageFile: path.resolve(imageFile),
    goldTranscriptFile: goldTranscriptFile ? path.resolve(goldTranscriptFile) : null,
    cloudProvider,
    cloudCooldownSeconds,
    betweenRunsSeconds,
    iterations,
    records,
  }, null, 2));

  console.log(`[ocr-live-iterate] summary written to ${summaryPath}`);
}

void main();
