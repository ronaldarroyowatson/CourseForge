// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, setLogLevel } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "courseforge-rules-test";
const OWNER_UID = "owner-user";
const OTHER_UID = "other-user";
const DISTRICT_ADMIN_UID = "district-admin-user";
const SUPER_ADMIN_UID = "super-admin-user";
const DISTRICT_ALPHA = "district-alpha";
const DISTRICT_BRAVO = "district-bravo";

let rulesEnv: RulesTestEnvironment;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientEmulatorStartupError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  const message = `${error.message} ${(error.cause as Error | undefined)?.message ?? ""}`;

  return code === "ETIMEDOUT"
    || code === "ECONNREFUSED"
    || /ETIMEDOUT|ECONNREFUSED|127\.0\.0\.1:4400/i.test(message);
}

async function initializeRulesEnvironmentWithRetry(options: {
  projectId: string;
  host: string;
  port: number;
  rules: string;
}): Promise<RulesTestEnvironment> {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await initializeTestEnvironment({
        projectId: options.projectId,
        firestore: {
          rules: options.rules,
          host: options.host,
          port: options.port,
        },
      });
    } catch (error) {
      if (!isTransientEmulatorStartupError(error) || attempt === maxAttempts) {
        throw error;
      }

      await sleep(400 * attempt);
    }
  }

  throw new Error("Unable to initialize Firestore rules test environment.");
}

function getEmulatorConnection(): { host: string; port: number } {
  const configuredHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (configuredHost) {
    const [hostPart, portPart] = configuredHost.split(":");
    const parsedPort = Number.parseInt(portPart ?? "", 10);
    if (hostPart && Number.isFinite(parsedPort)) {
      return { host: hostPart, port: parsedPort };
    }
  }

  // Keep a deterministic fallback aligned to firebase.json emulator defaults.
  return {
    host: "127.0.0.1",
    port: 9090,
  };
}

function nowIso(): string {
  return "2026-03-12T00:00:00.000Z";
}

function baseSyncFields() {
  return {
    userId: OWNER_UID,
    ownerId: OWNER_UID,
    pendingSync: false,
    source: "cloud",
    lastModified: nowIso(),
  } as const;
}

async function seedUserProfile(uid: string, data: Record<string, unknown>): Promise<void> {
  await rulesEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", uid), {
      uid,
      ...data,
    });
  });
}

async function seedCanonicalDoc(path: string, data: Record<string, unknown>): Promise<void> {
  await rulesEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

beforeAll(async () => {
  // Rules tests intentionally assert denied writes/reads; silence SDK transport
  // logs so stderr only reflects unexpected failures.
  setLogLevel("silent");

  const rulesPath = path.resolve(process.cwd(), "firestore.rules");
  const firestoreRules = readFileSync(rulesPath, "utf8");
  const emulator = getEmulatorConnection();

  rulesEnv = await initializeRulesEnvironmentWithRetry({
    projectId: PROJECT_ID,
    rules: firestoreRules,
    host: emulator.host,
    port: emulator.port,
  });
});

beforeEach(async () => {
  await rulesEnv.clearFirestore();
});

afterAll(async () => {
  if (rulesEnv) {
    await rulesEnv.cleanup();
  }
});

describe("Firestore rules: users + canonical hierarchy", () => {
  it("allows owner read/write on /users/{uid}", async () => {
    const ownerDb = rulesEnv.authenticatedContext(OWNER_UID).firestore();
    const ownerRef = doc(ownerDb, "users", OWNER_UID);

    await assertSucceeds(
      setDoc(ownerRef, {
        uid: OWNER_UID,
        displayName: "Owner",
        email: "owner@example.com",
        isAdmin: false,
      })
    );

    await assertSucceeds(getDoc(ownerRef));
  });

  it("blocks non-admin, non-owner read/write on /users/{uid}", async () => {
    const ownerDb = rulesEnv.authenticatedContext(OWNER_UID).firestore();
    const otherDb = rulesEnv.authenticatedContext(OTHER_UID).firestore();
    const ownerRef = doc(ownerDb, "users", OWNER_UID);
    const ownerRefFromOther = doc(otherDb, "users", OWNER_UID);

    await assertSucceeds(setDoc(ownerRef, { uid: OWNER_UID, displayName: "Owner" }));
    await assertFails(getDoc(ownerRefFromOther));
    await assertFails(setDoc(ownerRefFromOther, { uid: OWNER_UID, displayName: "Tamper" }));
  });

  it("blocks writes to /users/{uid}/textbooks, /chapters, /sections, /vocabTerms", async () => {
    const ownerDb = rulesEnv.authenticatedContext(OWNER_UID).firestore();

    const blockedPaths = [
      `users/${OWNER_UID}/textbooks/t-1`,
      `users/${OWNER_UID}/chapters/c-1`,
      `users/${OWNER_UID}/sections/s-1`,
      `users/${OWNER_UID}/vocabTerms/v-1`,
    ];

    for (const blockedPath of blockedPaths) {
      await assertFails(
        setDoc(doc(ownerDb, blockedPath), {
          ...baseSyncFields(),
          id: blockedPath.split("/").at(-1),
        })
      );
    }
  });

  it("blocks client reads/writes on config and rate-limit policy documents", async () => {
    const ownerDb = rulesEnv.authenticatedContext(OWNER_UID).firestore();

    await assertFails(
      setDoc(doc(ownerDb, "config/aiSafetyPolicy"), {
        defaultDailyRequestLimit: 10,
      })
    );

    await assertFails(
      setDoc(doc(ownerDb, "apiRateLimits/setAiProviderPolicy_abcd"), {
        count: 999,
      })
    );

    await rulesEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "config/aiSafetyPolicy"), {
        defaultDailyRequestLimit: 10,
      });
    });

    await assertFails(getDoc(doc(ownerDb, "config/aiSafetyPolicy")));
  });

  it("allows owner writes on canonical hierarchy paths with sync payload fields", async () => {
    const ownerDb = rulesEnv.authenticatedContext(OWNER_UID).firestore();
    const base = baseSyncFields();

    await assertSucceeds(
      setDoc(doc(ownerDb, "textbooks/tb-1"), {
        ...base,
        id: "tb-1",
        title: "Physics",
        grade: "10",
        subject: "Science",
        edition: "1",
        publicationYear: 2026,
        isbnRaw: "9780131103627",
        isbnNormalized: "9780131103627",
      })
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, "textbooks/tb-1/chapters/ch-1"), {
        ...base,
        id: "ch-1",
        textbookId: "tb-1",
        index: 1,
        name: "Chapter 1",
      })
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, "textbooks/tb-1/chapters/ch-1/sections/sec-1"), {
        ...base,
        id: "sec-1",
        textbookId: "tb-1",
        chapterId: "ch-1",
        index: 1,
        title: "Section 1",
      })
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, "textbooks/tb-1/chapters/ch-1/sections/sec-1/vocab/v-1"), {
        ...base,
        id: "v-1",
        textbookId: "tb-1",
        chapterId: "ch-1",
        sectionId: "sec-1",
        word: "atom",
      })
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, "textbooks/tb-1/chapters/ch-1/sections/sec-1/equations/eq-1"), {
        ...base,
        id: "eq-1",
        textbookId: "tb-1",
        chapterId: "ch-1",
        sectionId: "sec-1",
        name: "Force",
        latex: "F=ma",
      })
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, "textbooks/tb-1/chapters/ch-1/sections/sec-1/concepts/co-1"), {
        ...base,
        id: "co-1",
        textbookId: "tb-1",
        chapterId: "ch-1",
        sectionId: "sec-1",
        name: "Energy",
      })
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, "textbooks/tb-1/chapters/ch-1/sections/sec-1/keyIdeas/ki-1"), {
        ...base,
        id: "ki-1",
        textbookId: "tb-1",
        chapterId: "ch-1",
        sectionId: "sec-1",
        text: "Matter is conserved",
      })
    );
  });

  it("denies non-owner writes on canonical hierarchy docs", async () => {
    const ownerDb = rulesEnv.authenticatedContext(OWNER_UID).firestore();
    const otherDb = rulesEnv.authenticatedContext(OTHER_UID).firestore();
    const base = baseSyncFields();

    const canonicalDocs = [
      {
        path: "textbooks/tb-2",
        payload: {
          ...base,
          id: "tb-2",
          title: "Chemistry",
          grade: "10",
          subject: "Science",
          edition: "1",
          publicationYear: 2026,
          isbnRaw: "9780131101630",
          isbnNormalized: "9780131101630",
        },
      },
      {
        path: "textbooks/tb-2/chapters/ch-2",
        payload: { ...base, id: "ch-2", textbookId: "tb-2", index: 1, name: "Chapter 2" },
      },
      {
        path: "textbooks/tb-2/chapters/ch-2/sections/sec-2",
        payload: { ...base, id: "sec-2", textbookId: "tb-2", chapterId: "ch-2", index: 1, title: "Section 2" },
      },
      {
        path: "textbooks/tb-2/chapters/ch-2/sections/sec-2/vocab/v-2",
        payload: { ...base, id: "v-2", textbookId: "tb-2", chapterId: "ch-2", sectionId: "sec-2", word: "mole" },
      },
      {
        path: "textbooks/tb-2/chapters/ch-2/sections/sec-2/equations/eq-2",
        payload: {
          ...base,
          id: "eq-2",
          textbookId: "tb-2",
          chapterId: "ch-2",
          sectionId: "sec-2",
          name: "Gas law",
          latex: "PV=nRT",
        },
      },
      {
        path: "textbooks/tb-2/chapters/ch-2/sections/sec-2/concepts/co-2",
        payload: { ...base, id: "co-2", textbookId: "tb-2", chapterId: "ch-2", sectionId: "sec-2", name: "Pressure" },
      },
      {
        path: "textbooks/tb-2/chapters/ch-2/sections/sec-2/keyIdeas/ki-2",
        payload: {
          ...base,
          id: "ki-2",
          textbookId: "tb-2",
          chapterId: "ch-2",
          sectionId: "sec-2",
          text: "Gases are compressible",
        },
      },
    ];

    for (const canonicalDoc of canonicalDocs) {
      await assertSucceeds(setDoc(doc(ownerDb, canonicalDoc.path), canonicalDoc.payload));
      await assertFails(
        setDoc(
          doc(otherDb, canonicalDoc.path),
          {
            ...canonicalDoc.payload,
            title: "Tampered",
            name: "Tampered",
            text: "Tampered",
          },
          { merge: true }
        )
      );
    }
  });

  it("allows district admin reads for in-district users only", async () => {
    const districtAdminDb = rulesEnv.authenticatedContext(DISTRICT_ADMIN_UID, {
      admin: true,
      districtId: DISTRICT_ALPHA,
    }).firestore();

    await seedUserProfile(OWNER_UID, {
      displayName: "Owner",
      districtId: DISTRICT_ALPHA,
      districtName: DISTRICT_ALPHA,
      schoolId: "school-alpha",
    });
    await seedUserProfile(OTHER_UID, {
      displayName: "Other",
      districtId: DISTRICT_BRAVO,
      districtName: DISTRICT_BRAVO,
      schoolId: "school-bravo",
    });
    await seedUserProfile(DISTRICT_ADMIN_UID, {
      displayName: "District Admin",
      districtId: DISTRICT_ALPHA,
      districtName: DISTRICT_ALPHA,
      schoolId: "school-alpha",
    });

    await seedCanonicalDoc("textbooks/tb-district-alpha", {
      ...baseSyncFields(),
      userId: OWNER_UID,
      ownerId: OWNER_UID,
      title: "District Alpha Textbook",
    });

    await seedCanonicalDoc("textbooks/tb-district-bravo", {
      ...baseSyncFields(),
      userId: OTHER_UID,
      ownerId: OTHER_UID,
      title: "District Bravo Textbook",
    });

    await assertSucceeds(getDoc(doc(districtAdminDb, "users", OWNER_UID)));
    await assertFails(getDoc(doc(districtAdminDb, "users", OTHER_UID)));

    await assertSucceeds(getDoc(doc(districtAdminDb, "textbooks", "tb-district-alpha")));
    await assertFails(getDoc(doc(districtAdminDb, "textbooks", "tb-district-bravo")));
  });

  it("blocks district admin cross-user writes while allowing super admin override", async () => {
    const districtAdminDb = rulesEnv.authenticatedContext(DISTRICT_ADMIN_UID, {
      admin: true,
      districtId: DISTRICT_ALPHA,
    }).firestore();
    const superAdminDb = rulesEnv.authenticatedContext(SUPER_ADMIN_UID, { superAdmin: true }).firestore();
    const base = baseSyncFields();

    await seedUserProfile(OWNER_UID, {
      displayName: "Owner",
      districtId: DISTRICT_ALPHA,
      districtName: DISTRICT_ALPHA,
      schoolId: "school-alpha",
    });
    await seedUserProfile(DISTRICT_ADMIN_UID, {
      displayName: "District Admin",
      districtId: DISTRICT_ALPHA,
      districtName: DISTRICT_ALPHA,
      schoolId: "school-alpha",
    });
    await seedUserProfile(SUPER_ADMIN_UID, {
      displayName: "Super Admin",
      districtId: DISTRICT_BRAVO,
      districtName: DISTRICT_BRAVO,
      schoolId: "school-bravo",
    });

    await assertFails(
      setDoc(doc(districtAdminDb, "users", OWNER_UID), {
        uid: OWNER_UID,
        displayName: "Owner via district admin",
        email: "owner@example.com",
        isAdmin: false,
      })
    );
    await assertSucceeds(getDoc(doc(superAdminDb, "users", OWNER_UID)));

    const canonicalWrites = [
      {
        path: "textbooks/tb-admin",
        payload: {
          ...base,
          id: "tb-admin",
          title: "Admin Book",
          grade: "11",
          subject: "Math",
          edition: "2",
          publicationYear: 2026,
          isbnRaw: "9780131100000",
          isbnNormalized: "9780131100000",
        },
      },
      {
        path: "textbooks/tb-admin/chapters/ch-admin",
        payload: { ...base, id: "ch-admin", textbookId: "tb-admin", index: 1, name: "Admin Chapter" },
      },
      {
        path: "textbooks/tb-admin/chapters/ch-admin/sections/sec-admin",
        payload: {
          ...base,
          id: "sec-admin",
          textbookId: "tb-admin",
          chapterId: "ch-admin",
          index: 1,
          title: "Admin Section",
        },
      },
      {
        path: "textbooks/tb-admin/chapters/ch-admin/sections/sec-admin/vocab/v-admin",
        payload: {
          ...base,
          id: "v-admin",
          textbookId: "tb-admin",
          chapterId: "ch-admin",
          sectionId: "sec-admin",
          word: "vector",
        },
      },
      {
        path: "textbooks/tb-admin/chapters/ch-admin/sections/sec-admin/equations/eq-admin",
        payload: {
          ...base,
          id: "eq-admin",
          textbookId: "tb-admin",
          chapterId: "ch-admin",
          sectionId: "sec-admin",
          name: "Slope",
          latex: "y=mx+b",
        },
      },
      {
        path: "textbooks/tb-admin/chapters/ch-admin/sections/sec-admin/concepts/co-admin",
        payload: {
          ...base,
          id: "co-admin",
          textbookId: "tb-admin",
          chapterId: "ch-admin",
          sectionId: "sec-admin",
          name: "Derivative",
        },
      },
      {
        path: "textbooks/tb-admin/chapters/ch-admin/sections/sec-admin/keyIdeas/ki-admin",
        payload: {
          ...base,
          id: "ki-admin",
          textbookId: "tb-admin",
          chapterId: "ch-admin",
          sectionId: "sec-admin",
          text: "Rate of change",
        },
      },
    ];

    for (const canonicalDoc of canonicalWrites) {
      await assertFails(setDoc(doc(districtAdminDb, canonicalDoc.path), canonicalDoc.payload));
      await assertSucceeds(setDoc(doc(superAdminDb, canonicalDoc.path), canonicalDoc.payload));
    }
  });

  it("blocks direct client writes to debug reports and scopes reads by district/super-admin", async () => {
    const ownerDb = rulesEnv.authenticatedContext(OWNER_UID).firestore();
    const otherDb = rulesEnv.authenticatedContext(OTHER_UID).firestore();
    const districtAdminDb = rulesEnv.authenticatedContext(DISTRICT_ADMIN_UID, {
      admin: true,
      districtId: DISTRICT_ALPHA,
    }).firestore();
    const superAdminDb = rulesEnv.authenticatedContext(SUPER_ADMIN_UID, { superAdmin: true }).firestore();

    await seedUserProfile(OWNER_UID, {
      displayName: "Owner",
      districtId: DISTRICT_ALPHA,
      districtName: DISTRICT_ALPHA,
      schoolId: "school-alpha",
    });
    await seedUserProfile(OTHER_UID, {
      displayName: "Other",
      districtId: DISTRICT_BRAVO,
      districtName: DISTRICT_BRAVO,
      schoolId: "school-bravo",
    });
    await seedUserProfile(DISTRICT_ADMIN_UID, {
      displayName: "District Admin",
      districtId: DISTRICT_ALPHA,
      districtName: DISTRICT_ALPHA,
      schoolId: "school-alpha",
    });
    await seedUserProfile(SUPER_ADMIN_UID, {
      displayName: "Super Admin",
      districtId: DISTRICT_BRAVO,
      districtName: DISTRICT_BRAVO,
      schoolId: "school-bravo",
    });

    const debugReportPath = `debugReports/${OWNER_UID}/reports/1710500000000`;

    await assertFails(
      setDoc(doc(ownerDb, debugReportPath), {
        userId: OWNER_UID,
        entriesCount: 1,
        totalSizeBytes: 256,
      })
    );

    await rulesEnv.withSecurityRulesDisabled(async (context) => {
      const unrestricted = context.firestore();
      await setDoc(doc(unrestricted, debugReportPath), {
        userId: OWNER_UID,
        createdAt: nowIso(),
        uploadedAtMs: 1_710_500_000_000,
        entriesCount: 1,
        totalSizeBytes: 256,
      });
    });

    await assertSucceeds(getDoc(doc(ownerDb, debugReportPath)));
    await assertFails(getDoc(doc(otherDb, debugReportPath)));
    await assertSucceeds(getDoc(doc(districtAdminDb, debugReportPath)));
    await assertSucceeds(getDoc(doc(superAdminDb, debugReportPath)));
  });

  it("blocks legacy nested vocab path under /users and allows canonical vocab path", async () => {
    const ownerDb = rulesEnv.authenticatedContext(OWNER_UID).firestore();

    await assertFails(
      setDoc(doc(ownerDb, `users/${OWNER_UID}/sections/sec-legacy/vocab/v-legacy`), {
        ...baseSyncFields(),
        id: "v-legacy",
        textbookId: "tb-legacy",
        chapterId: "ch-legacy",
        sectionId: "sec-legacy",
        word: "legacy",
      })
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, "textbooks/tb-vocab/chapters/ch-vocab/sections/sec-vocab/vocab/v-owner"), {
        ...baseSyncFields(),
        id: "v-owner",
        textbookId: "tb-vocab",
        chapterId: "ch-vocab",
        sectionId: "sec-vocab",
        word: "canonical",
      })
    );
  });

  it("enforces owner/non-owner/district-admin/super-admin checks on canonical vocab path", async () => {
    const ownerDb = rulesEnv.authenticatedContext(OWNER_UID).firestore();
    const otherDb = rulesEnv.authenticatedContext(OTHER_UID).firestore();
    const districtAdminDb = rulesEnv.authenticatedContext(DISTRICT_ADMIN_UID, {
      admin: true,
      districtId: DISTRICT_ALPHA,
    }).firestore();
    const superAdminDb = rulesEnv.authenticatedContext(SUPER_ADMIN_UID, { superAdmin: true }).firestore();

    await seedUserProfile(OWNER_UID, {
      displayName: "Owner",
      districtId: DISTRICT_ALPHA,
      districtName: DISTRICT_ALPHA,
      schoolId: "school-alpha",
    });
    await seedUserProfile(OTHER_UID, {
      displayName: "Other",
      districtId: DISTRICT_BRAVO,
      districtName: DISTRICT_BRAVO,
      schoolId: "school-bravo",
    });
    await seedUserProfile(DISTRICT_ADMIN_UID, {
      displayName: "District Admin",
      districtId: DISTRICT_ALPHA,
      districtName: DISTRICT_ALPHA,
      schoolId: "school-alpha",
    });
    await seedUserProfile(SUPER_ADMIN_UID, {
      displayName: "Super Admin",
      districtId: DISTRICT_BRAVO,
      districtName: DISTRICT_BRAVO,
      schoolId: "school-bravo",
    });

    const canonicalPath = "textbooks/tb-vocab-2/chapters/ch-vocab-2/sections/sec-vocab-2/vocab/v-2";

    await assertSucceeds(
      setDoc(doc(ownerDb, canonicalPath), {
        ...baseSyncFields(),
        id: "v-2",
        textbookId: "tb-vocab-2",
        chapterId: "ch-vocab-2",
        sectionId: "sec-vocab-2",
        word: "owner-write",
      })
    );

    await assertFails(
      setDoc(
        doc(otherDb, canonicalPath),
        {
          ...baseSyncFields(),
          id: "v-2",
          textbookId: "tb-vocab-2",
          chapterId: "ch-vocab-2",
          sectionId: "sec-vocab-2",
          word: "tampered-by-other",
        },
        { merge: true }
      )
    );

    await assertFails(getDoc(doc(otherDb, canonicalPath)));

    await assertFails(
      setDoc(
        doc(districtAdminDb, canonicalPath),
        {
          ...baseSyncFields(),
          id: "v-2",
          textbookId: "tb-vocab-2",
          chapterId: "ch-vocab-2",
          sectionId: "sec-vocab-2",
          word: "admin-override",
        },
        { merge: true }
      )
    );

    await assertSucceeds(getDoc(doc(districtAdminDb, canonicalPath)));
    await assertSucceeds(
      setDoc(
        doc(superAdminDb, canonicalPath),
        {
          ...baseSyncFields(),
          id: "v-2",
          textbookId: "tb-vocab-2",
          chapterId: "ch-vocab-2",
          sectionId: "sec-vocab-2",
          word: "super-admin-override",
        },
        { merge: true }
      )
    );
  });

  it("keeps district admins without districtId claim scoped to self-only access", async () => {
    const districtAdminWithoutClaimDb = rulesEnv.authenticatedContext(DISTRICT_ADMIN_UID, {
      admin: true,
    }).firestore();

    await seedUserProfile(OWNER_UID, {
      displayName: "Owner",
      districtId: DISTRICT_ALPHA,
      districtName: DISTRICT_ALPHA,
      schoolId: "school-alpha",
    });
    await seedUserProfile(DISTRICT_ADMIN_UID, {
      displayName: "District Admin",
      districtId: DISTRICT_ALPHA,
      districtName: DISTRICT_ALPHA,
      schoolId: "school-alpha",
    });

    await seedCanonicalDoc("textbooks/tb-no-claim", {
      ...baseSyncFields(),
      userId: OWNER_UID,
      ownerId: OWNER_UID,
      title: "No Claim Access Check",
    });

    await assertSucceeds(getDoc(doc(districtAdminWithoutClaimDb, "users", DISTRICT_ADMIN_UID)));
    await assertFails(getDoc(doc(districtAdminWithoutClaimDb, "users", OWNER_UID)));
    await assertFails(getDoc(doc(districtAdminWithoutClaimDb, "textbooks", "tb-no-claim")));
  });

  it("rejects canonical vocab creation when owner fields are tampered (false-positive mutation guard)", async () => {
    const ownerDb = rulesEnv.authenticatedContext(OWNER_UID).firestore();

    await assertFails(
      setDoc(doc(ownerDb, "textbooks/tb-vocab-3/chapters/ch-vocab-3/sections/sec-vocab-3/vocab/v-3"), {
        ...baseSyncFields(),
        ownerId: OTHER_UID,
        userId: OTHER_UID,
        id: "v-3",
        textbookId: "tb-vocab-3",
        chapterId: "ch-vocab-3",
        sectionId: "sec-vocab-3",
        word: "tampered-owner",
      })
    );
  });
});