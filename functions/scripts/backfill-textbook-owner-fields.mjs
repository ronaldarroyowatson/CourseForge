#!/usr/bin/env node
import admin from "firebase-admin";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");

function printUsage() {
  console.log([
    "Usage: node functions/scripts/backfill-textbook-owner-fields.mjs [--apply] [--user <uid>] [--limit <count>]",
    "",
    "Dry-run is the default.",
    "Use --apply to persist updates after reviewing the candidate summary.",
  ].join("\n"));
}

function parseArgs(argv) {
  const options = {
    apply: false,
    userId: null,
    limit: null,
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg === "--user") {
      options.userId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--limit") {
      const raw = argv[index + 1] ?? "";
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value: ${raw || "<empty>"}`);
      }
      options.limit = parsed;
      index += 1;
      continue;
    }

    if (arg === "--project-id") {
      options.projectId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function detectProjectId() {
  const candidates = [
    path.join(REPO_ROOT, ".firebaserc"),
    path.join(REPO_ROOT, "src/firebase/firebaseConfig.ts"),
  ];

  for (const filePath of candidates) {
    try {
      const raw = await readFile(filePath, "utf8");

      if (filePath.endsWith(".firebaserc")) {
        const parsed = JSON.parse(raw);
        const projectId = trimString(parsed?.projects?.default);
        if (projectId) {
          return projectId;
        }
      }

      const match = raw.match(/projectId:\s*"([^"]+)"/);
      if (match?.[1]) {
        return match[1].trim();
      }
    } catch {
      // Best-effort project detection only.
    }
  }

  return null;
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function commitInBatches(firestore, updates) {
  const BATCH_SIZE = 400;

  for (let index = 0; index < updates.length; index += BATCH_SIZE) {
    const batch = firestore.batch();
    const slice = updates.slice(index, index + BATCH_SIZE);

    for (const update of slice) {
      batch.update(update.ref, update.payload);
    }

    await batch.commit();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectId = options.projectId || await detectProjectId();

  if (!admin.apps.length) {
    admin.initializeApp(projectId ? { projectId } : undefined);
  }

  const firestore = admin.firestore();
  let query = firestore.collection("textbooks");

  if (options.userId) {
    query = query.where("uploadedBy", "==", options.userId);
  }

  const snapshot = await query.get();
  const candidates = [];
  const conflicts = [];
  let alreadyNormalized = 0;
  let missingUploadedBy = 0;

  for (const docSnapshot of snapshot.docs) {
    const data = docSnapshot.data();
    const uploadedBy = trimString(data.uploadedBy);
    const userId = trimString(data.userId);
    const ownerId = trimString(data.ownerId);

    if (!uploadedBy) {
      missingUploadedBy += 1;
      continue;
    }

    const userIdConflicts = userId.length > 0 && userId !== uploadedBy;
    const ownerIdConflicts = ownerId.length > 0 && ownerId !== uploadedBy;

    if (userIdConflicts || ownerIdConflicts) {
      conflicts.push({
        id: docSnapshot.id,
        uploadedBy,
        userId: userId || null,
        ownerId: ownerId || null,
      });
      continue;
    }

    if (userId === uploadedBy && ownerId === uploadedBy) {
      alreadyNormalized += 1;
      continue;
    }

    candidates.push({
      id: docSnapshot.id,
      ref: docSnapshot.ref,
      payload: {
        userId: uploadedBy,
        ownerId: uploadedBy,
      },
      uploadedBy,
      previousUserId: userId || null,
      previousOwnerId: ownerId || null,
    });

    if (options.limit && candidates.length >= options.limit) {
      break;
    }
  }

  console.log(JSON.stringify({
    mode: options.apply ? "apply" : "dry-run",
    filterUserId: options.userId,
    scanned: snapshot.size,
    candidates: candidates.length,
    alreadyNormalized,
    missingUploadedBy,
    conflicts: conflicts.length,
  }, null, 2));

  if (candidates.length > 0) {
    console.log("Candidate textbook docs:");
    for (const candidate of candidates) {
      console.log(JSON.stringify({
        id: candidate.id,
        uploadedBy: candidate.uploadedBy,
        previousUserId: candidate.previousUserId,
        previousOwnerId: candidate.previousOwnerId,
        nextUserId: candidate.payload.userId,
        nextOwnerId: candidate.payload.ownerId,
      }));
    }
  }

  if (conflicts.length > 0) {
    console.log("Conflicting textbook docs skipped:");
    for (const conflict of conflicts) {
      console.log(JSON.stringify(conflict));
    }
  }

  if (!options.apply || candidates.length === 0) {
    return;
  }

  await commitInBatches(firestore, candidates);
  console.log(`Applied ownership backfill to ${candidates.length} textbook docs.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
