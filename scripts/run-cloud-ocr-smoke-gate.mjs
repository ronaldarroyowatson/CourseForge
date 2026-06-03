import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function getTokenFromMacKeychain(serviceName) {
  if (process.platform !== "darwin") {
    return "";
  }

  const account = process.env.USER ?? "";
  if (!account) {
    return "";
  }

  const probe = spawnSync("security", ["find-generic-password", "-a", account, "-s", serviceName, "-w"], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: process.env,
  });

  if (probe.status !== 0) {
    return "";
  }

  return String(probe.stdout ?? "").trim();
}

function hydrateSecureTokenEnvironment() {
  if (!process.env.OPENAI_API_KEY) {
    const openAiToken = getTokenFromMacKeychain("courseforge.OPENAI_API_KEY");
    if (openAiToken) {
      process.env.OPENAI_API_KEY = openAiToken;
      console.log("[smoke-gate] Loaded OPENAI_API_KEY from macOS Keychain.");
    }
  }

  if (!process.env.COURSEFORGE_GITHUB_TOKEN && !process.env.GITHUB_TOKEN) {
    const githubToken = getTokenFromMacKeychain("courseforge.COURSEFORGE_GITHUB_TOKEN");
    if (githubToken) {
      process.env.COURSEFORGE_GITHUB_TOKEN = githubToken;
      console.log("[smoke-gate] Loaded COURSEFORGE_GITHUB_TOKEN from macOS Keychain.");
    }
  }
}

function getGhTokenFromCli() {
  const probe = spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: process.env,
  });

  if (probe.status !== 0) {
    return "";
  }

  return String(probe.stdout ?? "").trim();
}

function hasToken() {
  return Boolean(
    process.env.OPENAI_API_KEY
    || process.env.COURSEFORGE_GITHUB_TOKEN
    || process.env.GITHUB_TOKEN
    || getGhTokenFromCli()
  );
}

function resolvePowerShellExecutable() {
  const candidates = process.platform === "win32"
    ? ["powershell.exe", "pwsh.exe", "powershell", "pwsh"]
    : ["pwsh", "powershell"];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: process.env,
    });

    if (probe.status === 0) {
      return candidate;
    }
  }

  return null;
}

function runCloudSmokeScript(scriptArgs = []) {
  const executable = resolvePowerShellExecutable();
  if (!executable) {
    console.error("[smoke-gate] PowerShell runtime not found. Install pwsh or powershell to run live cloud OCR smoke checks.");
    return 1;
  }

  const scriptPath = path.join(process.cwd(), "scripts", "smoke-cloud-ocr.ps1");
  const result = spawnSync(executable, ["-ExecutionPolicy", "Bypass", "-File", scriptPath, ...scriptArgs], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  if (typeof result.status === "number") {
    return result.status;
  }

  return 1;
}

hydrateSecureTokenEnvironment();

if (!hasToken()) {
  console.log("[smoke-gate] No cloud OCR tokens found. Skipping live cloud OCR smoke checks.");
  process.exit(0);
}

console.log("[smoke-gate] Cloud token detected. Running live cloud OCR smoke checks...");
const sampleDir = path.join(process.cwd(), "tmp-smoke", "samples");
const copyrightPath = path.join(sampleDir, "ocr__copyright-page__expect-metadata-success.png");
const tocPathPrimary = path.join(sampleDir, "ocr__toc-text-capture__expect-parse-success.png");
const tocPathSpread = path.join(sampleDir, "ocr__toc-spread-view__expect-parse-success.png");

const args = [];
if (fs.existsSync(copyrightPath)) {
  args.push("-CopyrightImagePath", copyrightPath);
}
if (fs.existsSync(tocPathPrimary)) {
  args.push("-TocImagePath", tocPathPrimary);
}
if (fs.existsSync(tocPathSpread)) {
  args.push("-TocImagePath2", tocPathSpread);
}

const retryCyclesRaw = process.env.COURSEFORGE_GITHUB_SMOKE_RETRY_CYCLES;
if (retryCyclesRaw && /^\d+$/.test(retryCyclesRaw.trim())) {
  args.push("-GitHubRateLimitRetryCycles", retryCyclesRaw.trim());
}

const batchSizeRaw = process.env.COURSEFORGE_GITHUB_SMOKE_BATCH_SIZE;
if (batchSizeRaw && /^\d+$/.test(batchSizeRaw.trim())) {
  args.push("-GitHubBatchSize", batchSizeRaw.trim());
}

const cooldownRaw = process.env.COURSEFORGE_GITHUB_SMOKE_BATCH_COOLDOWN_SECONDS;
if (cooldownRaw && /^\d+$/.test(cooldownRaw.trim())) {
  args.push("-GitHubBatchCooldownSeconds", cooldownRaw.trim());
}

const delayRaw = process.env.COURSEFORGE_GITHUB_SMOKE_INTER_REQUEST_DELAY_MS;
if (delayRaw && /^\d+$/.test(delayRaw.trim())) {
  args.push("-GitHubInterRequestDelayMs", delayRaw.trim());
}

const exitCode = runCloudSmokeScript(args);
process.exit(exitCode);
