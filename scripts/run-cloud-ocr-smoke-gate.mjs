import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function hasToken() {
  return Boolean(process.env.OPENAI_API_KEY || process.env.COURSEFORGE_GITHUB_TOKEN || process.env.GITHUB_TOKEN);
}

function runNpmScript(scriptName, scriptArgs = "") {
  const command = `npm run ${scriptName}${scriptArgs ? ` -- ${scriptArgs}` : ""}`;
  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", command], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  if (typeof result.status === "number") {
    return result.status;
  }

  return 1;
}

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
  args.push(`-CopyrightImagePath \"${copyrightPath}\"`);
}
if (fs.existsSync(tocPathPrimary)) {
  args.push(`-TocImagePath \"${tocPathPrimary}\"`);
}
if (fs.existsSync(tocPathSpread)) {
  args.push(`-TocImagePath2 \"${tocPathSpread}\"`);
}

const exitCode = runNpmScript("test:smoke:ocr:cloud", args.join(" "));
process.exit(exitCode);
