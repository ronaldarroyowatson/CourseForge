#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error("Usage: node scripts/mempalace-store-no-gemini.mjs <prompt_file> <payload_json>");
  process.exit(1);
}

const [promptFile, payloadFile] = args;
const result = spawnSync("mempalace", ["store", promptFile, payloadFile], {
  encoding: "utf8",
});

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";
const combined = `${stdout}${stderr}`;

if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

if (result.status === 0) {
  process.exit(0);
}

const shortIdMatch = combined.match(/short_id:\s*([A-Za-z0-9]+)/);
const hasSavedMemory = /Memory stored\s*[—-]\s*short_id:/.test(combined);
const missingGeminiKey = /No Gemini API key found\./.test(combined);

// In no-Gemini mode, a failed image-generation step is acceptable if payload storage succeeded.
if (hasSavedMemory && missingGeminiKey && shortIdMatch) {
  const shortId = shortIdMatch[1];
  console.log(`No-Gemini mode: payload stored successfully (short_id=${shortId}).`);
  process.exit(0);
}

process.exit(result.status ?? 1);
