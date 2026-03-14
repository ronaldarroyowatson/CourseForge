#!/usr/bin/env node

function parseArgs(argv) {
  const out = {
    min: null,
    max: null,
    label: "runtime",
    strict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--min") {
      out.min = Number.parseInt(argv[i + 1] ?? "", 10);
      i += 1;
      continue;
    }

    if (token === "--max") {
      out.max = Number.parseInt(argv[i + 1] ?? "", 10);
      i += 1;
      continue;
    }

    if (token === "--label") {
      out.label = argv[i + 1] ?? out.label;
      i += 1;
      continue;
    }

    if (token === "--strict") {
      out.strict = true;
      continue;
    }
  }

  return out;
}

function parseMajor(version) {
  return Number.parseInt(String(version).replace(/^v/, "").split(".")[0], 10);
}

function buildRangeText(min, max) {
  if (Number.isFinite(min) && Number.isFinite(max)) {
    return `>=${min} <${max}`;
  }

  if (Number.isFinite(min)) {
    return `>=${min}`;
  }

  if (Number.isFinite(max)) {
    return `<${max}`;
  }

  return "any";
}

const { min, max, label, strict } = parseArgs(process.argv.slice(2));
const major = parseMajor(process.version);
const valid = Number.isFinite(major);

if (!valid) {
  console.error(`[node-check] Unable to parse Node version: ${process.version}`);
  process.exit(1);
}

const tooLow = Number.isFinite(min) && major < min;
const tooHigh = Number.isFinite(max) && major >= max;
const inRange = !tooLow && !tooHigh;
const rangeText = buildRangeText(min, max);

if (inRange) {
  console.log(`[node-check] ${label}: Node ${major} satisfies ${rangeText}.`);
  process.exit(0);
}

const message = `[node-check] ${label}: Node ${major} does not satisfy ${rangeText}. Current version is ${process.version}.`;

if (strict) {
  console.error(message);
  process.exit(1);
}

console.warn(`${message} Continuing because strict mode is off.`);
