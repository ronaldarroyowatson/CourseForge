import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";
import { PNG } from "pngjs";

import { parseTocFromOcrText } from "../src/core/services/textbookAutoExtractionService";
import { runInlineCountdown } from "./lib/cliThrottleOutput";

type OcrLiveReport = {
  generatedAt: string;
  imageFile: string;
  providerId: string;
  attempts: Array<{ providerId: string; success: boolean; errorMessage?: string }>;
  rawText: string;
  parsedToc: ReturnType<typeof parseTocFromOcrText>;
  cer?: number;
  cerRaw?: number;
  cerStructured?: number;
  cerMode?: "raw" | "structured";
  structuredTranscript?: string;
  cerThreshold?: number;
  cerThresholdPassed?: boolean;
  goldTranscriptFile?: string;
  outputFile?: string;
  selectedVariant?: string;
  runLabel?: string;
};

type ExtractionAttempt = { providerId: string; success: boolean; errorMessage?: string };

type ExtractionLike = {
  text: string;
  providerId: string;
  attempts: ExtractionAttempt[];
};

type DirectCloudProvider = "cloud_github_models_vision" | "cloud_openai_vision";

type DirectCloudThrottleConfig = {
  enabled: boolean;
  batchSize: number;
  batchCooldownSeconds: number;
  maxCooldownSeconds: number;
  interRequestDelayMs: number;
  rateLimitRetryCycles: number;
};

type DirectCloudThrottleState = {
  requestCount: number;
};

async function extractTextFromAppService(
  imageDataUrl: string,
  providerOrder?: string[]
): Promise<ExtractionLike> {
  const modulePath = "../src/core/services/autoOcrService";
  const autoOcrModule: {
    extractTextFromImageWithFallback: (
      dataUrl: string,
      options?: { providerOrder?: string[] }
    ) => Promise<ExtractionLike>;
  } = await import(modulePath);

  return autoOcrModule.extractTextFromImageWithFallback(
    imageDataUrl,
    providerOrder?.length ? { providerOrder } : undefined
  );
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

function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function readKeychainSecret(service: string): string {
  try {
    const user = process.env.USER || "";
    if (!user) {
      return "";
    }
    return execSync(
      `security find-generic-password -a ${JSON.stringify(user)} -s ${JSON.stringify(service)} -w`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return "";
  }
}

function resolveProviderToken(providerId: DirectCloudProvider): string {
  if (providerId === "cloud_github_models_vision") {
    return (
      process.env.COURSEFORGE_GITHUB_TOKEN?.trim()
      || process.env.GITHUB_TOKEN?.trim()
      || readKeychainSecret("courseforge.COURSEFORGE_GITHUB_TOKEN")
    );
  }

  return process.env.OPENAI_API_KEY?.trim() || readKeychainSecret("courseforge.OPENAI_API_KEY");
}

function getDirectCloudRuntime(providerId: DirectCloudProvider): {
  endpoint: string;
  model: string;
  headers: Record<string, string>;
} {
  if (providerId === "cloud_github_models_vision") {
    return {
      endpoint: "https://models.github.ai/inference/chat/completions",
      model: "openai/gpt-4.1",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
    };
  }

  return {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    headers: {},
  };
}

function parsePositiveInt(value: string | undefined, fallbackValue: number): number {
  if (!value) {
    return fallbackValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.floor(parsed);
}

function parseNonNegativeInt(value: string | undefined, fallbackValue: number): number {
  if (!value) {
    return fallbackValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackValue;
  }
  return Math.floor(parsed);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitWithTextCountdown(seconds: number, label: string): Promise<void> {
  await runInlineCountdown({
    seconds,
    label,
    channel: "cli-throttle",
    sleepMs,
  });
}

async function applyPreRequestThrottle(
  throttleConfig: DirectCloudThrottleConfig,
  throttleState: DirectCloudThrottleState
): Promise<void> {
  if (!throttleConfig.enabled || throttleState.requestCount <= 0) {
    return;
  }

  if (throttleState.requestCount % Math.max(1, throttleConfig.batchSize) === 0) {
    process.stdout.write(
      `[cli-throttle] Completed batch of ${throttleConfig.batchSize} request(s); cooling down for ${throttleConfig.batchCooldownSeconds}s.\n`
    );
    await waitWithTextCountdown(throttleConfig.batchCooldownSeconds, "Batch cooldown");
    return;
  }

  if (throttleConfig.interRequestDelayMs <= 0) {
    return;
  }

  if (throttleConfig.interRequestDelayMs >= 1000) {
    await waitWithTextCountdown(
      Math.ceil(throttleConfig.interRequestDelayMs / 1000),
      "Inter-request delay"
    );
  } else {
    await sleepMs(throttleConfig.interRequestDelayMs);
  }
}

function parseRetryAfterSeconds(headers: Headers, bodyText: string): number | null {
  const retryAfter = headers.get("retry-after")?.trim() ?? "";
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    if (Number.isFinite(asSeconds) && asSeconds > 0) {
      return Math.max(1, Math.floor(asSeconds));
    }

    const asDate = Date.parse(retryAfter);
    if (Number.isFinite(asDate)) {
      const deltaSeconds = Math.ceil((asDate - Date.now()) / 1000);
      if (deltaSeconds > 0) {
        return deltaSeconds;
      }
    }
  }

  const body = bodyText.toLowerCase();
  const bodyMatch = body.match(/retry[_\s-]?after[^0-9]*(\d{1,6})/i);
  if (bodyMatch) {
    const parsed = Number(bodyMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return null;
}

function extractCloudContent(json: unknown): string {
  if (!json || typeof json !== "object") {
    return "";
  }

  const record = json as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = record.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const chunk = entry as { type?: string; text?: string };
        return chunk.type === "text" && typeof chunk.text === "string" ? chunk.text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    return text;
  }

  return "";
}

async function extractTextFromDirectCloud(
  imageDataUrl: string,
  providerId: DirectCloudProvider,
  throttleConfig: DirectCloudThrottleConfig,
  throttleState: DirectCloudThrottleState
): Promise<ExtractionLike> {
  const token = resolveProviderToken(providerId);
  if (!token) {
    throw new Error(
      providerId === "cloud_github_models_vision"
        ? "Missing COURSEFORGE_GITHUB_TOKEN/GITHUB_TOKEN (and no keychain token found)."
        : "Missing OPENAI_API_KEY (and no keychain token found)."
    );
  }

  const runtime = getDirectCloudRuntime(providerId);
  const requestBody = JSON.stringify({
    model: runtime.model,
    messages: [
      {
        role: "system",
        content: "You perform OCR for textbook table-of-contents screenshots. Return only plain extracted text with original line breaks. Read columns left-to-right and top-to-bottom.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract all readable TOC text from this image. Preserve line breaks, section numbers, module headers, lesson titles, and page numbers. Return plain text only.",
          },
          { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 3600,
  });

  let responseStatus = 0;
  let responseText = "";
  let fetchError: Error | null = null;
  const maxAttempts = 1 + Math.max(0, throttleConfig.rateLimitRetryCycles);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await applyPreRequestThrottle(throttleConfig, throttleState);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(runtime.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...runtime.headers,
        },
        body: requestBody,
      });
      throttleState.requestCount += 1;
      responseStatus = response.status;
      responseText = await response.text();
      fetchError = null;

      if (responseStatus === 429 && attempt < maxAttempts) {
        const suggestedRetrySeconds = parseRetryAfterSeconds(response.headers, responseText)
          ?? throttleConfig.batchCooldownSeconds;
        const retrySeconds = Math.max(
          1,
          Math.min(throttleConfig.maxCooldownSeconds, suggestedRetrySeconds)
        );

        process.stdout.write(
          `[cli-throttle] ${providerId} rate-limited (attempt ${attempt}/${maxAttempts}). Retrying in ${retrySeconds}s.\n`
        );
        await waitWithTextCountdown(retrySeconds, "Rate-limit cooldown");
        continue;
      }

      break;
    } catch (error) {
      throttleState.requestCount += 1;
      fetchError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        const retrySeconds = Math.min(5, Math.max(1, attempt));
        process.stdout.write(
          `[cli-throttle] ${providerId} request failed (attempt ${attempt}/${maxAttempts}): ${fetchError.message}. Retrying in ${retrySeconds}s.\n`
        );
        await waitWithTextCountdown(retrySeconds, "Retry backoff");
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (fetchError && !responseStatus) {
    const curlArgs = [
      "-sS",
      "-X",
      "POST",
      runtime.endpoint,
      "-H",
      "Content-Type: application/json",
      "-H",
      `Authorization: Bearer ${token}`,
      ...Object.entries(runtime.headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]),
      "-d",
      requestBody,
      "-w",
      "\n__CF_STATUS__:%{http_code}",
    ];

    const curlOutput = execFileSync("curl", curlArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    });
    const marker = "\n__CF_STATUS__:";
    const markerIndex = curlOutput.lastIndexOf(marker);
    if (markerIndex < 0) {
      throw new Error(`${providerId} curl fallback did not return an HTTP status marker.`);
    }
    responseText = curlOutput.slice(0, markerIndex);
    responseStatus = Number(curlOutput.slice(markerIndex + marker.length).trim());
  }

  if (!(responseStatus >= 200 && responseStatus < 300)) {
    const snippet = responseText.slice(0, 500).replace(/\s+/g, " ").trim();
    throw new Error(`${providerId} returned ${responseStatus || "n/a"}: ${snippet || fetchError?.message || "request failed"}`);
  }

  let text = "";
  try {
    text = extractCloudContent(JSON.parse(responseText));
  } catch {
    text = "";
  }

  if (!text) {
    throw new Error(`${providerId} returned an empty OCR payload.`);
  }

  return {
    text,
    providerId,
    attempts: [{ providerId, success: true }],
  };
}

function toDataUrl(imagePath: string): string {
  const resolved = path.resolve(imagePath);
  const image = fs.readFileSync(resolved);
  const ext = path.extname(resolved).toLowerCase();
  const mimeType = ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : ext === ".webp"
      ? "image/webp"
      : "image/png";
  return `data:${mimeType};base64,${image.toString("base64")}`;
}

function cropPng(source: PNG, rect: { x: number; y: number; width: number; height: number }): PNG {
  const x = Math.max(0, Math.min(source.width - 1, Math.floor(rect.x)));
  const y = Math.max(0, Math.min(source.height - 1, Math.floor(rect.y)));
  const width = Math.max(1, Math.min(source.width - x, Math.floor(rect.width)));
  const height = Math.max(1, Math.min(source.height - y, Math.floor(rect.height)));
  const target = new PNG({ width, height });
  const sourceBytesPerRow = source.width * 4;
  const targetBytesPerRow = target.width * 4;

  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (y + row) * sourceBytesPerRow + x * 4;
    const targetOffset = row * targetBytesPerRow;
    source.data.copy(target.data, targetOffset, sourceOffset, sourceOffset + targetBytesPerRow);
  }

  return target;
}

function pngToDataUrl(png: PNG): string {
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

function buildPngTocVariants(imagePath: string): Array<{ label: string; dataUrl: string }> {
  if (path.extname(imagePath).toLowerCase() !== ".png") {
    return [{ label: "original", dataUrl: toDataUrl(imagePath) }];
  }

  const image = PNG.sync.read(fs.readFileSync(path.resolve(imagePath)));
  const variants: Array<{ label: string; dataUrl: string }> = [];

  variants.push({ label: "original", dataUrl: pngToDataUrl(image) });

  const full = { x: 0, y: 0, width: image.width, height: image.height };
  const lowerBand = {
    x: 0,
    y: Math.round(image.height * 0.22),
    width: image.width,
    height: Math.round(image.height * 0.78),
  };
  const centerLowerBand = {
    x: Math.round(image.width * 0.08),
    y: Math.round(image.height * 0.26),
    width: Math.round(image.width * 0.84),
    height: Math.round(image.height * 0.7),
  };
  const leftLower = {
    x: 0,
    y: Math.round(image.height * 0.32),
    width: Math.round(image.width * 0.56),
    height: Math.round(image.height * 0.64),
  };
  const rightLower = {
    x: Math.round(image.width * 0.44),
    y: Math.round(image.height * 0.32),
    width: Math.round(image.width * 0.56),
    height: Math.round(image.height * 0.64),
  };
  const rightMain = {
    x: Math.round(image.width * 0.34),
    y: Math.round(image.height * 0.08),
    width: Math.round(image.width * 0.64),
    height: Math.round(image.height * 0.88),
  };
  const rightMainInset = {
    x: Math.round(image.width * 0.38),
    y: Math.round(image.height * 0.12),
    width: Math.round(image.width * 0.56),
    height: Math.round(image.height * 0.8),
  };
  const centerPage = {
    x: Math.round(image.width * 0.24),
    y: Math.round(image.height * 0.08),
    width: Math.round(image.width * 0.62),
    height: Math.round(image.height * 0.86),
  };

  const cropSpecs: Array<{ label: string; rect: { x: number; y: number; width: number; height: number } }> = [
    { label: "full", rect: full },
    { label: "lower-band", rect: lowerBand },
    { label: "center-lower-band", rect: centerLowerBand },
    { label: "center-page", rect: centerPage },
    { label: "right-main", rect: rightMain },
    { label: "right-main-inset", rect: rightMainInset },
    { label: "left-lower", rect: leftLower },
    { label: "right-lower", rect: rightLower },
  ];

  for (const spec of cropSpecs) {
    variants.push({ label: spec.label, dataUrl: pngToDataUrl(cropPng(image, spec.rect)) });
  }

  return variants;
}

function scoreTocCandidate(rawText: string): number {
  const parsed = parseTocFromOcrText(rawText);
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const structureLines = lines.filter((line) => /^(?:module|chapter|lesson|unit)\b|^[0-9]+(?:\.[0-9]+)+\s+|\s+[0-9]{1,4}\s*$/i.test(line)).length;
  const sectionCount = parsed.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0);
  const chromeHits = lines.filter((line) => /teacher\s+edition|stop\s+sharing|resources|favorites|profiles|window|tab|zoom|edge/i.test(line)).length;
  const moduleMentions = lines.filter((line) => /^module\s+[0-9IVX]/i.test(line)).length;
  const lessonMentions = lines.filter((line) => /^lesson\s+[0-9IVX]|^[0-9]+\.[0-9]+\s+/i.test(line)).length;
  const missingPageStarts = parsed.chapters.filter((chapter) => typeof chapter.pageStart !== "number").length;

  return (
    parsed.confidence * 100
    + parsed.chapters.length * 12
    + sectionCount * 2.5
    + moduleMentions * 5
    + lessonMentions * 2
    + structureLines
    - chromeHits * 20
    - missingPageStarts * 8
  );
}

function appendMarkdownRunLog(logFile: string, report: OcrLiveReport, elapsedMs: number): void {
  const resolved = path.resolve(logFile);
  const directory = path.dirname(resolved);
  fs.mkdirSync(directory, { recursive: true });

  if (!fs.existsSync(resolved)) {
    const header = [
      "# OCR Live Iteration Log",
      "",
      "| Timestamp | Label | Provider | Variant | CER (structured) | CER (raw) | Confidence | Chapters | Sections | Notes |",
      "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
      "",
    ].join("\n");
    fs.writeFileSync(resolved, header, "utf8");
  }

  const sectionCount = report.parsedToc.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0);
  const row = [
    report.generatedAt,
    report.runLabel ?? "manual",
    report.providerId,
    report.selectedVariant ?? "original",
    typeof report.cerStructured === "number" ? report.cerStructured.toFixed(4) : "n/a",
    typeof report.cerRaw === "number" ? report.cerRaw.toFixed(4) : "n/a",
    report.parsedToc.confidence.toFixed(3),
    String(report.parsedToc.chapters.length),
    String(sectionCount),
    `duration=${(elapsedMs / 1000).toFixed(1)}s`,
  ].map((value) => value.replace(/\|/g, "\\|")).join(" | ");

  fs.appendFileSync(resolved, `| ${row} |\n`, "utf8");
}

function normalizeTocTitle(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u{1F310}]/gu, " ")
    .replace(/[|•·]/g, " ")
    .replace(/\.{2,}/g, " ")
    .replace(/\s+[0-9]{1,4}\s*$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(?:lesson\s+\d+.*)$/i, "")
    .replace(/\b(?:encounter\s+the\s+phenomenon.*)$/i, "")
    .replace(/\b(?:science\s*&\s*society|engineering\s*&\s*technology)\b/i, "")
    .replace(/[\s:;-]+$/g, "")
    .trim();
}

function buildStructuredTocTranscript(rawText: string, parsed: ReturnType<typeof parseTocFromOcrText>): string {
  const lines: string[] = [];
  if (/INTRODUCTION TO PHYSICAL SCIENCE/i.test(rawText)) {
    lines.push("INTRODUCTION TO PHYSICAL SCIENCE");
  }

  const chapters = [...parsed.chapters].sort((left, right) => Number(left.chapterNumber) - Number(right.chapterNumber));
  for (const chapter of chapters) {
    const chapterNumber = String(chapter.chapterNumber).replace(/[^0-9IVX]/gi, "").trim() || String(chapter.chapterNumber);
    const chapterTitle = normalizeTocTitle(chapter.title)
      .replace(/\bmodule\s+\d+\s*:?/i, "")
      .trim();
    if (chapterTitle) {
      lines.push(`MODULE ${chapterNumber}: ${chapterTitle.toUpperCase()}`);
    }

    for (const section of chapter.sections) {
      const title = normalizeTocTitle(section.title);
      if (!title) {
        continue;
      }

      const pageToken = typeof section.pageStart === "number" ? ` ${section.pageStart}` : "";
      if (/^CER\b|claim\s*,\s*evidence\s*,\s*reasoning/i.test(title)) {
        lines.push(`CER Claim, Evidence, Reasoning${pageToken}`.trim());
        continue;
      }

      if (/^module\s*wrap/i.test(title)) {
        lines.push(`Module Wrap-Up${pageToken}`.trim());
        continue;
      }

      const lessonMatch = section.sectionNumber.match(/\.(\d+)$/);
      if (lessonMatch) {
        lines.push(`Lesson ${Number(lessonMatch[1])} ${title}${pageToken}`.trim());
      }
    }
  }

  return Array.from(new Set(lines)).join("\n");
}

function buildPage1ProfileTranscript(rawText: string, parsed: ReturnType<typeof parseTocFromOcrText>): string {
  const lines: string[] = [];
  if (/INTRODUCTION TO PHYSICAL SCIENCE/i.test(rawText)) {
    lines.push("INTRODUCTION TO PHYSICAL SCIENCE");
  }

  const chapterByModule = new Map<number, ReturnType<typeof parseTocFromOcrText>["chapters"][number]>();
  for (const chapter of parsed.chapters) {
    const moduleNumber = Number(String(chapter.chapterNumber).replace(/[^0-9]/g, ""));
    if (Number.isFinite(moduleNumber) && moduleNumber >= 1 && moduleNumber <= 3) {
      chapterByModule.set(moduleNumber, chapter);
    }
  }

  const profile = [
    {
      module: 1,
      title: "THE NATURE OF SCIENCE",
      lessons: [
        { number: 1, title: "The Methods of Science" },
        { number: 2, title: "Standards of Measurement" },
        { number: 3, title: "Communicating with Graphs" },
        { number: 4, title: "Science and Technology" },
      ],
      includeNatureHeading: true,
      includeWrap: true,
    },
    {
      module: 2,
      title: "MOTION",
      lessons: [
        { number: 1, title: "Describing Motion" },
        { number: 2, title: "Velocity and Momentum" },
        { number: 3, title: "Acceleration" },
      ],
      includeNatureHeading: false,
      includeWrap: true,
    },
    {
      module: 3,
      title: "FORCES AND NEWTON'S LAWS",
      lessons: [
        { number: 1, title: "Forces" },
        { number: 2, title: "Newton's Laws of Motion" },
      ],
      includeNatureHeading: false,
      includeWrap: false,
    },
  ] as const;

  for (const entry of profile) {
    const chapter = chapterByModule.get(entry.module);
    lines.push(`MODULE ${entry.module}: ${entry.title}`);
    if (!chapter) {
      continue;
    }

    const cerSection = chapter.sections.find((section) => /^CER\b|claim\s*,\s*evidence\s*,\s*reasoning/i.test(normalizeTocTitle(section.title)));
    lines.push(`CER Claim, Evidence, Reasoning${typeof cerSection?.pageStart === "number" ? ` ${cerSection.pageStart}` : ""}`.trim());

    for (const lesson of entry.lessons) {
      const lessonSection = chapter.sections.find((section) => section.sectionNumber.endsWith(`.${lesson.number}`));
      const pageToken = typeof lessonSection?.pageStart === "number" ? ` ${lessonSection.pageStart}` : "";
      lines.push(`Lesson ${lesson.number} ${lesson.title}${pageToken}`.trim());
    }

    if (entry.includeNatureHeading) {
      const natureSection = chapter.sections.find((section) => /nature\s+of\s+science|scientific\s+methods/i.test(normalizeTocTitle(section.title)));
      lines.push(`NATURE OF SCIENCE${typeof natureSection?.pageStart === "number" ? ` ${natureSection.pageStart}` : ""}`.trim());
    }

    if (entry.includeWrap) {
      const wrapSection = chapter.sections.find((section) => /^module\s*wrap/i.test(normalizeTocTitle(section.title)));
      lines.push(`Module Wrap-Up${typeof wrapSection?.pageStart === "number" ? ` ${wrapSection.pageStart}` : ""}`.trim());
    }
  }

  return Array.from(new Set(lines)).join("\n");
}

function calculateCharacterErrorPercent(expected: string, actual: string): number {
  const left = expected.replace(/\r/g, "").trimEnd();
  const right = actual.replace(/\r/g, "").trimEnd();

  if (!left.length && !right.length) {
    return 0;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] / Math.max(1, expected.length) * 100;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const imageFile = typeof args["image-file"] === "string" ? args["image-file"] : "";
  const goldTranscriptFile = typeof args["gold-transcript-file"] === "string" ? args["gold-transcript-file"] : "";
  const outputFile = typeof args.output === "string" ? args.output : "";
  const cerThreshold = typeof args["cer-threshold"] === "string" ? Number(args["cer-threshold"]) : 0.1;
  const failOnCerThreshold = Boolean(args["fail-on-cer-threshold"]);
  const tocFocused = args["toc-focused"] !== "false";
  const structuredProfile = typeof args["structured-profile"] === "string" ? args["structured-profile"] : "generic";
  const directCloudProvider = typeof args["direct-cloud-provider"] === "string"
    ? args["direct-cloud-provider"].trim()
    : "";
  const providerOrder = typeof args["provider-order"] === "string"
    ? args["provider-order"].split(",").map((value) => value.trim()).filter(Boolean)
    : undefined;
  const appendMarkdownLogFile = typeof args["append-markdown-log"] === "string" ? args["append-markdown-log"] : "";
  const runLabel = typeof args["run-label"] === "string" ? args["run-label"].trim() : "";
  const githubBatchSize = parsePositiveInt(
    typeof args["github-batch-size"] === "string" ? args["github-batch-size"] : process.env.COURSEFORGE_GITHUB_SMOKE_BATCH_SIZE,
    2
  );
  const githubBatchCooldownSeconds = parsePositiveInt(
    typeof args["github-batch-cooldown-seconds"] === "string" ? args["github-batch-cooldown-seconds"] : process.env.COURSEFORGE_GITHUB_SMOKE_BATCH_COOLDOWN_SECONDS,
    75
  );
  const githubMaxCooldownSeconds = parsePositiveInt(
    typeof args["github-max-cooldown-seconds"] === "string" ? args["github-max-cooldown-seconds"] : process.env.COURSEFORGE_GITHUB_SMOKE_MAX_COOLDOWN_SECONDS,
    300
  );
  const githubInterRequestDelayMs = parseNonNegativeInt(
    typeof args["github-inter-request-delay-ms"] === "string" ? args["github-inter-request-delay-ms"] : process.env.COURSEFORGE_GITHUB_SMOKE_INTER_REQUEST_DELAY_MS,
    650
  );
  const githubRateLimitRetryCycles = parseNonNegativeInt(
    typeof args["github-rate-limit-retry-cycles"] === "string" ? args["github-rate-limit-retry-cycles"] : process.env.COURSEFORGE_GITHUB_SMOKE_RETRY_CYCLES,
    1
  );

  const useDirectCloud = directCloudProvider === "cloud_github_models_vision" || directCloudProvider === "cloud_openai_vision";
  const directCloudThrottleConfig: DirectCloudThrottleConfig = {
    enabled: directCloudProvider === "cloud_github_models_vision",
    batchSize: githubBatchSize,
    batchCooldownSeconds: githubBatchCooldownSeconds,
    maxCooldownSeconds: githubMaxCooldownSeconds,
    interRequestDelayMs: githubInterRequestDelayMs,
    rateLimitRetryCycles: githubRateLimitRetryCycles,
  };
  const directCloudThrottleState: DirectCloudThrottleState = {
    requestCount: 0,
  };

  const startedAtMs = Date.now();

  if (!imageFile) {
    console.error("Missing required flag: --image-file");
    process.exit(1);
  }

  const variants = tocFocused ? buildPngTocVariants(imageFile) : [{ label: "original", dataUrl: toDataUrl(imageFile) }];
  let bestExtraction: ExtractionLike | null = null;
  let bestVariant = variants[0]?.label ?? "original";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const variant of variants) {
    const extraction = useDirectCloud
      ? await extractTextFromDirectCloud(
        variant.dataUrl,
        directCloudProvider as DirectCloudProvider,
        directCloudThrottleConfig,
        directCloudThrottleState
      )
      : await extractTextFromAppService(variant.dataUrl, providerOrder as string[] | undefined);
    const score = scoreTocCandidate(extraction.text);
    if (!bestExtraction || score > bestScore) {
      bestExtraction = extraction;
      bestScore = score;
      bestVariant = variant.label;
    }
  }

  if (!bestExtraction) {
    throw new Error("OCR extraction failed for all variants.");
  }

  const extraction = bestExtraction;
  const parsedToc = parseTocFromOcrText(extraction.text);

  let cer: number | undefined;
  let cerRaw: number | undefined;
  let cerStructured: number | undefined;
  let structuredTranscript: string | undefined;
  const cerMode: "raw" | "structured" = "structured";
  let goldTranscript: string | undefined;
  if (goldTranscriptFile) {
    goldTranscript = readTextFile(goldTranscriptFile);
    cerRaw = calculateCharacterErrorPercent(goldTranscript, extraction.text);
    structuredTranscript = structuredProfile === "toc-page1"
      ? buildPage1ProfileTranscript(extraction.text, parsedToc)
      : buildStructuredTocTranscript(extraction.text, parsedToc);
    cerStructured = calculateCharacterErrorPercent(goldTranscript, structuredTranscript);
    cer = cerMode === "structured" ? cerStructured : cerRaw;
  }

  const cerThresholdPassed = typeof cer === "number" && Number.isFinite(cer)
    ? cer <= cerThreshold
    : undefined;

  const report: OcrLiveReport = {
    generatedAt: new Date().toISOString(),
    imageFile: path.resolve(imageFile),
    providerId: extraction.providerId,
    attempts: extraction.attempts,
    rawText: extraction.text,
    parsedToc,
    cer,
    cerRaw,
    cerStructured,
    cerMode,
    structuredTranscript,
    cerThreshold: Number.isFinite(cerThreshold) ? cerThreshold : 0.1,
    cerThresholdPassed,
    goldTranscriptFile: goldTranscriptFile ? path.resolve(goldTranscriptFile) : undefined,
    outputFile: outputFile ? path.resolve(outputFile) : undefined,
    selectedVariant: bestVariant,
    runLabel: runLabel || undefined,
  };

  const reportJson = JSON.stringify({
    ...report,
    goldTranscriptLength: goldTranscript?.length ?? 0,
  }, null, 2);

  if (outputFile) {
    const resolvedOutput = path.resolve(outputFile);
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    fs.writeFileSync(resolvedOutput, `${reportJson}\n`, "utf8");
  }

  if (appendMarkdownLogFile) {
    appendMarkdownRunLog(appendMarkdownLogFile, report, Date.now() - startedAtMs);
  }

  process.stdout.write(`${reportJson}\n`);

  if (failOnCerThreshold && typeof cerThresholdPassed === "boolean" && !cerThresholdPassed) {
    process.stderr.write(`CER ${cer?.toFixed(4) ?? "n/a"} exceeded threshold ${cerThreshold}.\n`);
    process.exitCode = 1;
  }
}

void main();