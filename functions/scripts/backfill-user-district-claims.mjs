#!/usr/bin/env node
import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

function printUsage() {
  console.log([
    "Usage: node functions/scripts/backfill-user-district-claims.mjs --uid <uid> --district-name <name> [--district-id <id>] [--apply]",
    "",
    "Dry-run is the default.",
    "Use --apply to persist changes to Firestore and Auth custom claims.",
  ].join("\n"));
}

function normalizeDistrictId(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseArgs(argv) {
  const options = {
    uid: "",
    districtName: "",
    districtId: "",
    apply: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--uid") {
      options.uid = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }

    if (arg === "--district-name") {
      options.districtName = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }

    if (arg === "--district-id") {
      options.districtId = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.uid) {
    throw new Error("--uid is required");
  }

  if (!options.districtName && !options.districtId) {
    throw new Error("Provide --district-name and/or --district-id");
  }

  const normalizedDistrictId = options.districtId || normalizeDistrictId(options.districtName);
  if (!normalizedDistrictId) {
    throw new Error("Could not derive districtId from inputs");
  }

  return {
    ...options,
    districtId: normalizedDistrictId,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const firebaseRcPath = path.resolve(process.cwd(), ".firebaserc");
  let projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  if (!projectId && fs.existsSync(firebaseRcPath)) {
    try {
      const firebaseRc = JSON.parse(fs.readFileSync(firebaseRcPath, "utf8"));
      const defaultProject = firebaseRc?.projects?.default;
      if (typeof defaultProject === "string" && defaultProject.trim()) {
        projectId = defaultProject.trim();
      }
    } catch {
      // Ignore parse errors and allow Admin SDK defaults to fail loudly.
    }
  }

  if (!admin.apps.length) {
    if (projectId) {
      admin.initializeApp({ projectId });
    } else {
      admin.initializeApp();
    }
  }

  const firestore = admin.firestore();
  const auth = admin.auth();

  const userRef = firestore.doc(`users/${opts.uid}`);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new Error(`users/${opts.uid} not found`);
  }

  const userData = userSnap.data() || {};
  const existingSchoolId = typeof userData.schoolId === "string" ? userData.schoolId : "";
  const existingDistrictName = typeof userData.districtName === "string" ? userData.districtName : "";
  const nextDistrictName = opts.districtName || existingDistrictName || null;

  const userRecord = await auth.getUser(opts.uid);
  const nextClaims = {
    ...(userRecord.customClaims || {}),
    districtId: opts.districtId,
  };

  const preview = {
    mode: opts.apply ? "apply" : "dry-run",
    uid: opts.uid,
    districtId: opts.districtId,
    districtName: nextDistrictName,
    schoolId: existingSchoolId || null,
    previousUserDistrictId: typeof userData.districtId === "string" ? userData.districtId : null,
    previousClaimDistrictId: typeof userRecord.customClaims?.districtId === "string" ? userRecord.customClaims.districtId : null,
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!opts.apply) {
    return;
  }

  const writes = [];

  writes.push(userRef.set({
    uid: opts.uid,
    districtId: opts.districtId,
    districtName: nextDistrictName,
    updatedAt: new Date().toISOString(),
    lastClaimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }));

  if (existingSchoolId) {
    writes.push(firestore.doc(`schools/${existingSchoolId}`).set({
      districtId: opts.districtId,
      districtName: nextDistrictName,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }));
  }

  await Promise.all(writes);
  await auth.setCustomUserClaims(opts.uid, nextClaims);

  console.log(`Applied district backfill for uid ${opts.uid}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
