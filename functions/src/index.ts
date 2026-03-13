import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

admin.initializeApp();

const auth = admin.auth();
const firestore = admin.firestore();
const SUPPORTED_COLLECTIONS = ["textbooks", "chapters", "sections", "vocab", "equations", "concepts", "keyIdeas"] as const;
type SupportedCollection = (typeof SUPPORTED_COLLECTIONS)[number];

type ContentStatus = "draft" | "submitted" | "approved" | "rejected";

interface CallableResult<T> {
  success: boolean;
  message: string;
  data: T;
}

interface AdminUserRecord {
  uid: string;
  displayName: string;
  email: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  isAdmin: boolean;
}

interface PremiumUsageState {
  premiumRequestsUsedToday: number;
  premiumRequestsUsedThisWeek: number;
  premiumRequestsUsedThisMonth: number;
  dailyLimitPercent: number;
  weeklyLimitPercent: number;
  monthlyLimitPercent: number;
  freezePremium: boolean;
  lastResetDate: string;
  lastResetWeek: string;
  lastResetMonth: string;
}

interface AdminPremiumUsageRow {
  uid: string;
  email: string;
  displayName: string;
  premiumTier: string;
  premiumUsage: PremiumUsageState;
}

interface ModerationItem {
  docPath: string;
  collectionName: SupportedCollection;
  ownerId: string;
  ownerEmail: string | null;
  title: string;
  currentStatus: ContentStatus;
  lastModified: string | null;
  isArchived?: boolean;
}

interface AdminContentRecord {
  docPath: string;
  id: string;
  collectionName: SupportedCollection;
  ownerId: string;
  ownerEmail: string | null;
  title: string;
  grade?: string;
  subject?: string;
  edition?: string;
  publicationYear?: number;
  isbnRaw?: string;
  summary?: string;
  status: ContentStatus;
  isArchived: boolean;
  isDeleted: boolean;
  lastModified: string | null;
}

function success<T>(message: string, data: T): CallableResult<T> {
  return { success: true, message, data };
}

function assertAdmin(authData: { token?: Record<string, unknown> } | null | undefined): void {
  if (!authData) {
    throw new HttpsError("unauthenticated", "You must be signed in to use admin functions.");
  }

  if (authData.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin privileges are required for this action.");
  }
}

function toIsoString(value: unknown): string | null {
  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === "string" ? value : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

const MONTHLY_BASELINE_PERCENT = 8.6;
const DAILY_BASELINE_MULTIPLIER = 0.4;
const WEEKLY_BASELINE_MULTIPLIER = 2.7;
const MONTHLY_LIMIT_PERCENT = 100;

function roundToOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function getDefaultDailyLimitPercent(): number {
  return roundToOneDecimal(MONTHLY_BASELINE_PERCENT * DAILY_BASELINE_MULTIPLIER);
}

function getDefaultWeeklyLimitPercent(): number {
  return roundToOneDecimal(MONTHLY_BASELINE_PERCENT * WEEKLY_BASELINE_MULTIPLIER);
}

function getDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getMonthlyResetAnchor(year: number, monthIndex: number): Date {
  const resetDay = Math.min(31, getDaysInMonth(year, monthIndex));
  return new Date(year, monthIndex, resetDay, 7, 0, 0, 0);
}

function toMonthlyResetKey(anchor: Date): string {
  return `${anchor.getFullYear()}-${pad2(anchor.getMonth() + 1)}-${pad2(anchor.getDate())}@07:00`;
}

function getMonthlyResetKey(now = new Date()): string {
  const currentAnchor = getMonthlyResetAnchor(now.getFullYear(), now.getMonth());
  if (now.getTime() >= currentAnchor.getTime()) {
    return toMonthlyResetKey(currentAnchor);
  }

  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousAnchor = getMonthlyResetAnchor(previousMonth.getFullYear(), previousMonth.getMonth());
  return toMonthlyResetKey(previousAnchor);
}

function getIsoWeekKey(now = new Date()): string {
  const dayMs = 24 * 60 * 60 * 1000;
  const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);

  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / dayMs) + 1) / 7);

  return `${isoYear}-W${pad2(week)}`;
}

function createDefaultPremiumUsage(now = new Date()): PremiumUsageState {
  return {
    premiumRequestsUsedToday: 0,
    premiumRequestsUsedThisWeek: 0,
    premiumRequestsUsedThisMonth: 0,
    dailyLimitPercent: getDefaultDailyLimitPercent(),
    weeklyLimitPercent: getDefaultWeeklyLimitPercent(),
    monthlyLimitPercent: MONTHLY_LIMIT_PERCENT,
    freezePremium: false,
    lastResetDate: getDateKey(now),
    lastResetWeek: getIsoWeekKey(now),
    lastResetMonth: getMonthlyResetKey(now),
  };
}

function normalizePremiumUsage(value: unknown, now = new Date()): PremiumUsageState {
  const defaults = createDefaultPremiumUsage(now);
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

  return {
    premiumRequestsUsedToday: Number(record.premiumRequestsUsedToday ?? defaults.premiumRequestsUsedToday),
    premiumRequestsUsedThisWeek: Number(record.premiumRequestsUsedThisWeek ?? defaults.premiumRequestsUsedThisWeek),
    premiumRequestsUsedThisMonth: Number(record.premiumRequestsUsedThisMonth ?? defaults.premiumRequestsUsedThisMonth),
    dailyLimitPercent: Number(record.dailyLimitPercent ?? defaults.dailyLimitPercent),
    weeklyLimitPercent: Number(record.weeklyLimitPercent ?? defaults.weeklyLimitPercent),
    monthlyLimitPercent: Number(record.monthlyLimitPercent ?? defaults.monthlyLimitPercent),
    freezePremium: record.freezePremium === true,
    lastResetDate: typeof record.lastResetDate === "string" ? record.lastResetDate : defaults.lastResetDate,
    lastResetWeek: typeof record.lastResetWeek === "string" ? record.lastResetWeek : defaults.lastResetWeek,
    lastResetMonth: typeof record.lastResetMonth === "string" ? record.lastResetMonth : defaults.lastResetMonth,
  };
}

function applyPremiumResets(usage: PremiumUsageState, now = new Date()): PremiumUsageState {
  const next = { ...usage };
  const dateKey = getDateKey(now);
  const weekKey = getIsoWeekKey(now);
  const monthKey = getMonthlyResetKey(now);

  if (next.lastResetDate !== dateKey) {
    next.premiumRequestsUsedToday = 0;
    next.lastResetDate = dateKey;
  }

  if (next.lastResetWeek !== weekKey) {
    next.premiumRequestsUsedThisWeek = 0;
    next.lastResetWeek = weekKey;
  }

  if (next.lastResetMonth !== monthKey) {
    next.premiumRequestsUsedThisMonth = 0;
    next.lastResetMonth = monthKey;
  }

  if (next.premiumRequestsUsedThisMonth > next.monthlyLimitPercent) {
    next.freezePremium = true;
  }

  return next;
}

async function getPremiumUsageDocRef(uid: string): Promise<FirebaseFirestore.DocumentReference> {
  return firestore.doc(`users/${uid}/premiumUsage/current`);
}

async function getOrCreatePremiumUsage(uid: string): Promise<PremiumUsageState> {
  const docRef = await getPremiumUsageDocRef(uid);
  const snapshot = await docRef.get();
  const normalized = normalizePremiumUsage(snapshot.exists ? snapshot.data() : null);
  const resetUsage = applyPremiumResets(normalized);

  if (!snapshot.exists || JSON.stringify(resetUsage) !== JSON.stringify(normalized)) {
    await docRef.set(resetUsage, { merge: true });
  }

  return resetUsage;
}

function parseDocPath(docPath: string): { ownerId: string | null; collectionName: SupportedCollection; docId: string } {
  const parts = docPath.split("/");

  if (parts.length === 2 && parts[0] === "textbooks") {
    return {
      ownerId: null,
      collectionName: "textbooks",
      docId: parts[1],
    };
  }

  if (parts.length === 4 && parts[0] === "textbooks" && parts[2] === "chapters") {
    return {
      ownerId: null,
      collectionName: "chapters",
      docId: parts[3],
    };
  }

  if (parts.length === 6 && parts[0] === "textbooks" && parts[2] === "chapters" && parts[4] === "sections") {
    return {
      ownerId: null,
      collectionName: "sections",
      docId: parts[5],
    };
  }

  if (parts.length === 8 && parts[0] === "textbooks" && parts[2] === "chapters" && parts[4] === "sections" && parts[6] === "vocab") {
    return {
      ownerId: null,
      collectionName: "vocab",
      docId: parts[7],
    };
  }

  if (parts.length === 8 && parts[0] === "textbooks" && parts[2] === "chapters" && parts[4] === "sections" && parts[6] === "equations") {
    return {
      ownerId: null,
      collectionName: "equations",
      docId: parts[7],
    };
  }

  if (parts.length === 8 && parts[0] === "textbooks" && parts[2] === "chapters" && parts[4] === "sections" && parts[6] === "concepts") {
    return {
      ownerId: null,
      collectionName: "concepts",
      docId: parts[7],
    };
  }

  if (parts.length === 8 && parts[0] === "textbooks" && parts[2] === "chapters" && parts[4] === "sections" && parts[6] === "keyIdeas") {
    return {
      ownerId: null,
      collectionName: "keyIdeas",
      docId: parts[7],
    };
  }

  throw new HttpsError("invalid-argument", "Unsupported document path.");
}

async function getOwnerEmailMap(): Promise<Map<string, string>> {
  const snapshot = await firestore.collection("users").get();
  const map = new Map<string, string>();

  for (const docSnap of snapshot.docs) {
    const email = docSnap.get("email");
    if (typeof email === "string" && email.length > 0) {
      map.set(docSnap.id, email);
    }
  }

  return map;
}

function getRecordTitle(collectionName: SupportedCollection, data: FirebaseFirestore.DocumentData, fallbackId: string): string {
  switch (collectionName) {
    case "textbooks":
      return typeof data.title === "string" ? data.title : fallbackId;
    case "chapters":
      return typeof data.name === "string" ? data.name : fallbackId;
    case "sections":
      return typeof data.title === "string" ? data.title : fallbackId;
    case "vocab":
      return typeof data.word === "string" ? data.word : fallbackId;
    case "equations":
      return typeof data.name === "string" ? data.name : fallbackId;
    case "concepts":
      return typeof data.name === "string" ? data.name : fallbackId;
    case "keyIdeas":
      return typeof data.text === "string" ? data.text : fallbackId;
  }
}

function getRecordSummary(collectionName: SupportedCollection, data: FirebaseFirestore.DocumentData): string | undefined {
  switch (collectionName) {
    case "chapters":
      return typeof data.description === "string" ? data.description : undefined;
    case "sections":
      return typeof data.notes === "string" ? data.notes : undefined;
    case "vocab":
      return typeof data.definition === "string" ? data.definition : undefined;
    case "equations":
      return typeof data.description === "string" ? data.description : undefined;
    case "concepts":
      return typeof data.explanation === "string" ? data.explanation : undefined;
    case "keyIdeas":
      return typeof data.text === "string" ? data.text : undefined;
    default:
      return undefined;
  }
}

function toAdminUserRecord(snapshot: FirebaseFirestore.QueryDocumentSnapshot): AdminUserRecord {
  const data = snapshot.data();
  return {
    uid: typeof data.uid === "string" ? data.uid : snapshot.id,
    displayName: typeof data.displayName === "string" ? data.displayName : "",
    email: typeof data.email === "string" ? data.email : "",
    createdAt: toIsoString(data.createdAt),
    lastLoginAt: toIsoString(data.lastLoginAt),
    isAdmin: data.isAdmin === true,
  };
}

function buildAdminContentRecord(
  collectionName: SupportedCollection,
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
  ownerEmailMap: Map<string, string>
): AdminContentRecord {
  const data = snapshot.data();
  const ownerId = typeof data.ownerId === "string"
    ? data.ownerId
    : typeof data.userId === "string"
      ? data.userId
      : "unknown";

  return {
    docPath: snapshot.ref.path,
    id: snapshot.id,
    collectionName,
    ownerId,
    ownerEmail: ownerEmailMap.get(ownerId) ?? null,
    title: getRecordTitle(collectionName, data, snapshot.id),
    grade: typeof data.grade === "string" ? data.grade : undefined,
    subject: typeof data.subject === "string" ? data.subject : undefined,
    edition: typeof data.edition === "string" ? data.edition : undefined,
    publicationYear: typeof data.publicationYear === "number" ? data.publicationYear : undefined,
    isbnRaw: typeof data.isbnRaw === "string" ? data.isbnRaw : undefined,
    summary: getRecordSummary(collectionName, data),
    status: (typeof data.status === "string" ? data.status : "draft") as ContentStatus,
    isArchived: data.isArchived === true,
    isDeleted: data.isDeleted === true,
    lastModified: toIsoString(data.lastModified),
  };
}

function buildModerationItem(
  collectionName: SupportedCollection,
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
  ownerEmailMap: Map<string, string>
): ModerationItem {
  const data = snapshot.data();
  const ownerId = typeof data.ownerId === "string"
    ? data.ownerId
    : typeof data.userId === "string"
      ? data.userId
      : "unknown";

  return {
    docPath: snapshot.ref.path,
    collectionName,
    ownerId,
    ownerEmail: ownerEmailMap.get(ownerId) ?? null,
    title: getRecordTitle(collectionName, data, snapshot.id),
    currentStatus: "submitted",
    lastModified: toIsoString(data.lastModified),
    isArchived: data.isArchived === true,
  };
}

export const setUserAdminStatus = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const uid = typeof data?.uid === "string" ? data.uid.trim() : "";
  const isAdmin = data?.isAdmin === true;

  if (!uid) {
    throw new HttpsError("invalid-argument", "A user id is required.");
  }

  const userRecord = await auth.getUser(uid);
  const nextClaims = { ...(userRecord.customClaims ?? {}) } as Record<string, unknown>;

  if (isAdmin) {
    nextClaims.admin = true;
  } else {
    delete nextClaims.admin;
  }

  await auth.setCustomUserClaims(uid, nextClaims);
  await firestore.doc(`users/${uid}`).set(
    {
      uid,
      email: userRecord.email ?? "",
      displayName: userRecord.displayName ?? "",
      isAdmin,
      lastClaimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const message = isAdmin
    ? `Granted admin access to ${uid}.`
    : `Removed admin access from ${uid}.`;

  return success(message, message);
});

export const listAdminUsers = onCall(async (request) => {
  assertAdmin(request.auth);

  const snapshot = await firestore.collection("users").orderBy("email").get();
  return success("Loaded users.", snapshot.docs.map(toAdminUserRecord));
});

export const getModerationQueue = onCall(async (request) => {
  assertAdmin(request.auth);

  const ownerEmailMap = await getOwnerEmailMap();
  const items: ModerationItem[] = [];

  await Promise.all(
    SUPPORTED_COLLECTIONS.map(async (collectionName) => {
        const snapshot = await firestore.collectionGroup(collectionName).where("status", "==", "submitted").get();
        snapshot.docs.forEach((docSnap) => {
          items.push(buildModerationItem(collectionName, docSnap, ownerEmailMap));
        });
      })
  );

  items.sort((left, right) => (right.lastModified ?? "").localeCompare(left.lastModified ?? ""));
  return success("Loaded moderation queue.", items);
});

export const updateModerationStatus = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const docPath = typeof data?.docPath === "string" ? data.docPath : "";
  const status = typeof data?.status === "string" ? data.status as ContentStatus : null;

  if (!docPath || !status) {
    throw new HttpsError("invalid-argument", "A document path and status are required.");
  }

  parseDocPath(docPath);
  await firestore.doc(docPath).update({
    status,
    pendingSync: false,
    lastModified: new Date().toISOString(),
  });

  return success(`Updated status to ${status}.`, `Updated status to ${status}.`);
});

export const archiveAdminContent = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const docPath = typeof data?.docPath === "string" ? data.docPath : "";
  const isArchived = data?.isArchived !== false;

  if (!docPath) {
    throw new HttpsError("invalid-argument", "A document path is required.");
  }

  parseDocPath(docPath);
  await firestore.doc(docPath).update({
    isArchived,
    pendingSync: false,
    lastModified: new Date().toISOString(),
  });

  return success(isArchived ? "Content archived." : "Content restored from archive.", isArchived ? "Content archived." : "Content restored from archive.");
});

export const softDeleteAdminContent = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const docPath = typeof data?.docPath === "string" ? data.docPath : "";
  const isDeleted = data?.isDeleted !== false;

  if (!docPath) {
    throw new HttpsError("invalid-argument", "A document path is required.");
  }

  parseDocPath(docPath);
  await firestore.doc(docPath).update({
    isDeleted,
    pendingSync: false,
    lastModified: new Date().toISOString(),
  });

  return success(isDeleted ? "Content hidden from non-admin users." : "Content restored.", isDeleted ? "Content hidden from non-admin users." : "Content restored.");
});

export const searchAdminContent = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const titleContains = typeof data?.titleContains === "string" ? data.titleContains.toLowerCase() : "";
  const isbn = typeof data?.isbn === "string" ? data.isbn.replace(/-/g, "") : "";
  const ownerEmailFilter = typeof data?.ownerEmail === "string" ? data.ownerEmail.toLowerCase() : "";
  const ownerUidFilter = typeof data?.ownerUid === "string" ? data.ownerUid : "";
  const requestedCollection = typeof data?.collectionName === "string" ? data.collectionName : "all";

  const collections = requestedCollection === "all"
    ? SUPPORTED_COLLECTIONS
    : SUPPORTED_COLLECTIONS.filter((name) => name === requestedCollection);

  const ownerEmailMap = await getOwnerEmailMap();
  const allowedOwnerIds = new Set<string>();

  if (ownerEmailFilter) {
    ownerEmailMap.forEach((email, uid) => {
      if (email.toLowerCase().includes(ownerEmailFilter)) {
        allowedOwnerIds.add(uid);
      }
    });
  }

  if (ownerUidFilter) {
    allowedOwnerIds.add(ownerUidFilter);
  }

  const records: AdminContentRecord[] = [];

  await Promise.all(collections.map(async (collectionName) => {
    const snapshot = await firestore.collectionGroup(collectionName).get();
    snapshot.docs.forEach((docSnap) => {
      const record = buildAdminContentRecord(collectionName, docSnap, ownerEmailMap);
      const normalizedIsbn = (record.isbnRaw ?? "").replace(/-/g, "");

      if (titleContains && !record.title.toLowerCase().includes(titleContains)) {
        return;
      }

      if (isbn && !normalizedIsbn.includes(isbn)) {
        return;
      }

      if (allowedOwnerIds.size > 0 && !allowedOwnerIds.has(record.ownerId)) {
        return;
      }

      records.push(record);
    });
  }));

  records.sort((left, right) => (right.lastModified ?? "").localeCompare(left.lastModified ?? ""));
  return success("Loaded admin content.", records);
});

export const updateAdminContent = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const docPath = typeof data?.docPath === "string" ? data.docPath : "";
  const updates = typeof data?.data === "object" && data?.data !== null ? data.data as Record<string, unknown> : null;

  if (!docPath || !updates) {
    throw new HttpsError("invalid-argument", "A document path and update payload are required.");
  }

  const { collectionName } = parseDocPath(docPath);
  const allowedFields: Record<SupportedCollection, string[]> = {
    textbooks: ["title", "grade", "subject", "edition", "publicationYear", "status"],
    chapters: ["name", "description", "status"],
    sections: ["title", "notes", "status"],
    vocab: ["word", "definition", "status"],
    equations: ["name", "latex", "description", "status"],
    concepts: ["name", "explanation", "status"],
    keyIdeas: ["text", "status"],
  };

  const sanitizedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([key, value]) => allowedFields[collectionName].includes(key) && value !== undefined)
  );

  if (Object.keys(sanitizedUpdates).length === 0) {
    throw new HttpsError("invalid-argument", "No supported fields were provided for update.");
  }

  await firestore.doc(docPath).update({
    ...sanitizedUpdates,
    pendingSync: false,
    lastModified: new Date().toISOString(),
  });

  return success("Content updated.", "Content updated.");
});

export const getPremiumUsageReport = onCall(async (request) => {
  assertAdmin(request.auth);

  const usersSnapshot = await firestore.collection("users").orderBy("email").get();
  const rows: AdminPremiumUsageRow[] = [];

  await Promise.all(
    usersSnapshot.docs.map(async (userDoc) => {
      const data = userDoc.data();
      const usage = await getOrCreatePremiumUsage(userDoc.id);
      rows.push({
        uid: userDoc.id,
        email: typeof data.email === "string" ? data.email : "",
        displayName: typeof data.displayName === "string" ? data.displayName : "",
        premiumTier: typeof data.premiumTier === "string" ? data.premiumTier : "free",
        premiumUsage: usage,
      });
    })
  );

  rows.sort((a, b) => a.email.localeCompare(b.email));
  return success("Loaded premium usage report.", rows);
});

export const managePremiumUser = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const uid = typeof data?.uid === "string" ? data.uid.trim() : "";
  const action = typeof data?.action === "string" ? data.action : "";
  const freezePremium = data?.freezePremium === true;

  if (!uid) {
    throw new HttpsError("invalid-argument", "A user id is required.");
  }

  if (!["freeze", "unfreeze", "resetDaily", "resetWeekly", "resetMonthly"].includes(action)) {
    throw new HttpsError("invalid-argument", "Unsupported premium usage action.");
  }

  const userRef = firestore.doc(`users/${uid}`);
  const userSnapshot = await userRef.get();

  if (!userSnapshot.exists) {
    throw new HttpsError("not-found", "User not found.");
  }

  const usageRef = await getPremiumUsageDocRef(uid);
  const current = await getOrCreatePremiumUsage(uid);
  const next = { ...current };

  if (action === "freeze") {
    next.freezePremium = freezePremium !== false;
  }

  if (action === "unfreeze") {
    next.freezePremium = false;
  }

  if (action === "resetDaily") {
    next.premiumRequestsUsedToday = 0;
    next.lastResetDate = getDateKey();
  }

  if (action === "resetWeekly") {
    next.premiumRequestsUsedThisWeek = 0;
    next.lastResetWeek = getIsoWeekKey();
  }

  if (action === "resetMonthly") {
    next.premiumRequestsUsedThisMonth = 0;
    next.lastResetMonth = getMonthlyResetKey();
  }

  await usageRef.set(next, { merge: true });

  const userData = userSnapshot.data() ?? {};
  const row: AdminPremiumUsageRow = {
    uid,
    email: typeof userData.email === "string" ? userData.email : "",
    displayName: typeof userData.displayName === "string" ? userData.displayName : "",
    premiumTier: typeof userData.premiumTier === "string" ? userData.premiumTier : "free",
    premiumUsage: next,
  };

  return success("Premium usage updated.", row);
});

export const getCurrentPremiumUsage = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const usage = await getOrCreatePremiumUsage(request.auth.uid);
  return success("Loaded premium usage.", usage);
});
