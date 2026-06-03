import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { CosmosClient, type Container } from "@azure/cosmos";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  analyzeDocumentQuality,
  buildExtractionPrompts,
  createEmptyExtractionData,
  extractReadableDocumentText,
  mergeQualityReports,
  type DocumentExtractionContext,
  type ExtractedDocumentData,
  type ExtractionQualityReport,
} from "./documentExtraction";

dotenv.config();

const openAiKeySecret = defineSecret("OPENAI_API_KEY");
const githubModelsTokenSecret = defineSecret("COURSEFORGE_GITHUB_TOKEN");
const azureCosmosConnectionStringSecret = defineSecret("AZURE_COSMOS_CONNECTION_STRING");

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

type DifficultyLevel = 1 | 2 | 3;

interface TieredQuestionSourceMetadata {
  sourceType: string;
  originalFilename: string;
  variationAllowed: boolean;
  educationalContext?: {
    textbookTitle?: string;
    textbookSubject?: string;
    gradeLevel?: number;
    targetReadingLevel?: number;
  };
  inferredLocation?: {
    chapter?: number;
    section?: number;
  };
}

interface TieredVariationGenerationContext {
  textbookTitle?: string;
  textbookSubject?: string;
  gradeLevel?: number;
  level2TargetReadingGrade?: number;
  level3TargetReadingGrade?: number;
}

interface TieredQuestionSeedItem {
  id: string;
  contentType: "vocab" | "concept";
  question: string;
  correctAnswer: string;
  sourceMetadata: TieredQuestionSourceMetadata;
}

interface TieredQuestionItem {
  id: string;
  baseItemId: string;
  contentType: "vocab" | "concept";
  question: string;
  correctAnswer: string;
  distractors: string[];
  difficultyLevel: DifficultyLevel;
  isOriginal: boolean;
  variationOf: string | null;
  sourceMetadata: TieredQuestionSourceMetadata;
}

interface AdminUserRecord {
  uid: string;
  displayName: string;
  email: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  isAdmin: boolean;
  isSchoolAdmin?: boolean;
  isSuperAdmin?: boolean;
  schoolId?: string | null;
  schoolName?: string | null;
  districtName?: string | null;
  isContentBlocked?: boolean;
  contentBlockReason?: string | null;
}

interface SchoolDirectoryRow {
  schoolId: string;
  schoolName: string;
  districtName?: string | null;
  memberCount: number;
}

interface SchoolUserRow {
  uid: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  isSchoolAdmin: boolean;
  schoolId?: string | null;
  schoolName?: string | null;
  districtName?: string | null;
  lastLoginAt?: string | null;
}

interface SchoolTextbookRow {
  id: string;
  docPath: string;
  ownerId: string;
  ownerEmail: string | null;
  title: string;
  subject?: string;
  grade?: string;
  isDeleted: boolean;
  recycleBinDeletedAt?: string | null;
  recycleBinExpiresAt?: string | null;
  lastModified?: string | null;
}

interface SchoolInviteRow {
  id: string;
  email: string;
  schoolId: string;
  schoolName: string;
  districtName?: string | null;
  invitedByUid: string;
  invitedByEmail?: string | null;
  createdAt: string | null;
  status: "pending" | "accepted" | "revoked";
}

interface SchoolDashboardResult {
  schoolId: string;
  schoolName: string;
  districtName?: string | null;
  users: SchoolUserRow[];
  textbooks: SchoolTextbookRow[];
  invites: SchoolInviteRow[];
}

interface PromotionRequestRow {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  schoolId: string;
  schoolName: string;
  districtName?: string | null;
  reason?: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

interface SuperAdminDashboardStats {
  usersCount: number;
  schoolsCount: number;
  textbooksCount: number;
  pendingPromotionRequests: number;
  trackedReadsToday: number | null;
  trackedWritesToday: number | null;
  trackedAiRequestsToday: number | null;
  trackedAiBucketHitsToday: number | null;
}

interface SuperAdminGlobalQuotaDetails {
  metric: string;
  displayName: string | null;
  unit: string | null;
  effectiveLimit: number | null;
  defaultLimit: number | null;
}

interface GoogleCloudProjectMetadata {
  projectId?: string;
  projectNumber?: string | number;
}

interface SuperAdminGlobalQuotaResult {
  projectId: string;
  fetchedAt: string;
  source: "serviceusage" | "fallback";
  readLimitPerDay: number | null;
  writeLimitPerDay: number | null;
  deleteLimitPerDay: number | null;
  functionInvocationsLimitPerMonth: number | null;
  message: string | null;
  details: SuperAdminGlobalQuotaDetails[];
}

interface SuperAdminAzureQuotaResult {
  projectId: string;
  fetchedAt: string;
  source: "env" | "fallback";
  configured: boolean;
  mirrorEnabled: boolean;
  databaseId: string;
  containerId: string;
  requestUnitsPerSecondLimit: number | null;
  requestUnitsPerDayLimit: number | null;
  storageGbLimit: number | null;
  currentReadsToday: number | null;
  currentWritesToday: number | null;
  currentRequestUnitsToday: number | null;
  currentErrorsToday: number | null;
  message: string | null;
}

type BackupPrimaryDb = "firestore" | "cosmos";
type BackupMode = "interval" | "manual";

interface SuperAdminBackupConfigResult {
  primaryDb: BackupPrimaryDb;
  mirrorEnabled: boolean;
  firestoreEnabled: boolean;
  cosmosEnabled: boolean;
  backupMode: BackupMode;
  frequencyMinutes: number;
  lastBackupAt: string | null;
  nextBackupAt: string | null;
  updatedBy: string;
  updatedAt: string;
}

interface SuperAdminBackupJobResult {
  id: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "partial" | "failed";
  docsScanned: number;
  docsMirrored: number;
  docsFailed: number;
  requestUnitsUsed: number;
  message: string;
}

const DEFAULT_FIRESTORE_READ_LIMIT_PER_DAY = 50000;
const DEFAULT_FIRESTORE_WRITE_LIMIT_PER_DAY = 20000;
const DEFAULT_FIRESTORE_DELETE_LIMIT_PER_DAY = 20000;
const DEFAULT_FUNCTION_INVOCATIONS_LIMIT_PER_MONTH = 2000000;
const DEFAULT_AZURE_COSMOS_DATABASE_ID = "courseforge";
const DEFAULT_AZURE_COSMOS_CONTAINER_ID = "textbooks";
const DEFAULT_BACKUP_FREQUENCY_MINUTES = 240;
const BACKUP_FREQUENCY_MINUTES_MIN = 15;
const BACKUP_FREQUENCY_MINUTES_MAX = 7 * 24 * 60;
const BACKUP_DOC_LIMIT_PER_COLLECTION = 250;
const BACKUP_RUN_LEASE_MS = 12 * 60 * 1000;
const BACKUP_STALE_RUNNING_MS = 30 * 60 * 1000;

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

function isMissingCollectionGroupIndexError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  const code = typeof candidate.code === "number" ? candidate.code : null;
  return code === 9 || message.includes("failed_precondition") || message.includes("collection_group") || message.includes("collectiongroup");
}

async function fetchBackupSnapshotsForCollection(
  collectionName: SupportedCollection,
  sinceIso: string,
): Promise<{ snapshots: FirebaseFirestore.QuerySnapshot[]; usedIndexFallback: boolean }> {
  try {
    const snapshots = await Promise.all([
      firestore.collectionGroup(collectionName).where("updatedAt", ">", sinceIso).limit(BACKUP_DOC_LIMIT_PER_COLLECTION).get(),
      firestore.collectionGroup(collectionName).where("lastModified", ">", sinceIso).limit(BACKUP_DOC_LIMIT_PER_COLLECTION).get(),
    ]);
    return { snapshots, usedIndexFallback: false };
  } catch (error) {
    if (!isMissingCollectionGroupIndexError(error)) {
      throw error;
    }

    // Fallback path for environments missing collection-group timestamp indexes.
    const snapshot = await firestore.collectionGroup(collectionName).limit(BACKUP_DOC_LIMIT_PER_COLLECTION * 4).get();
    return { snapshots: [snapshot], usedIndexFallback: true };
  }
}

function parsePositiveEnvNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

async function readAzureUsageTotals(): Promise<{
  readsToday: number;
  writesToday: number;
  requestUnitsToday: number;
  errorsToday: number;
}> {
  const usageSnapshot = await firestore.collectionGroup("azureUsage").get();
  let readsToday = 0;
  let writesToday = 0;
  let requestUnitsToday = 0;
  let errorsToday = 0;

  usageSnapshot.docs.forEach((docSnap) => {
    if (docSnap.id !== "current") {
      return;
    }

    const data = docSnap.data() as Record<string, unknown>;
    const reads = typeof data.readsToday === "number" ? data.readsToday : 0;
    const writes = typeof data.writesToday === "number" ? data.writesToday : 0;
    const requestUnits = typeof data.requestUnitsToday === "number" ? data.requestUnitsToday : 0;
    const errors = typeof data.errorsToday === "number" ? data.errorsToday : 0;

    readsToday += Math.max(0, Math.floor(reads));
    writesToday += Math.max(0, Math.floor(writes));
    requestUnitsToday += Math.max(0, Math.floor(requestUnits));
    errorsToday += Math.max(0, Math.floor(errors));
  });

  return { readsToday, writesToday, requestUnitsToday, errorsToday };
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return null;
}

function normalizeBackupConfig(value: unknown): SuperAdminBackupConfigResult {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

  const primaryDb: BackupPrimaryDb = data.primaryDb === "cosmos" ? "cosmos" : "firestore";
  const backupMode: BackupMode = data.backupMode === "manual" ? "manual" : "interval";
  const rawFrequency = typeof data.frequencyMinutes === "number"
    ? data.frequencyMinutes
    : DEFAULT_BACKUP_FREQUENCY_MINUTES;
  const frequencyMinutes = Math.max(BACKUP_FREQUENCY_MINUTES_MIN, Math.min(BACKUP_FREQUENCY_MINUTES_MAX, Math.floor(rawFrequency)));
  const lastBackupAt = toIsoOrNull(data.lastBackupAt);
  const updatedAt = toIsoOrNull(data.updatedAt) ?? new Date(0).toISOString();
  const nextBackupAt = lastBackupAt
    ? new Date(Date.parse(lastBackupAt) + frequencyMinutes * 60 * 1000).toISOString()
    : null;

  return {
    primaryDb,
    mirrorEnabled: data.mirrorEnabled !== false,
    firestoreEnabled: data.firestoreEnabled !== false,
    cosmosEnabled: data.cosmosEnabled !== false,
    backupMode,
    frequencyMinutes,
    lastBackupAt,
    nextBackupAt,
    updatedBy: typeof data.updatedBy === "string" && data.updatedBy.trim().length > 0 ? data.updatedBy : "system",
    updatedAt,
  };
}

function getBackupConfigDocRef(): FirebaseFirestore.DocumentReference {
  return firestore.doc("system/backupConfig");
}

function getBackupJobsCollectionRef(): FirebaseFirestore.CollectionReference {
  return firestore.collection("systemBackupJobs");
}

function getBackupRuntimeDocRef(): FirebaseFirestore.DocumentReference {
  return firestore.doc("system/backupRuntime");
}

function readSecretOrEnv(secret: { value: () => string }, envName: string): string {
  try {
    const secretValue = secret.value();
    if (typeof secretValue === "string" && secretValue.trim().length > 0) {
      return secretValue.trim();
    }
  } catch {
    // Secret access is only available when the function is bound to this secret.
  }

  return (process.env[envName] ?? "").trim();
}

function getAzureCosmosCredentials(): { connectionString: string; endpoint: string; key: string } {
  const connectionString = readSecretOrEnv(azureCosmosConnectionStringSecret, "AZURE_COSMOS_CONNECTION_STRING");
  const endpoint = (process.env.AZURE_COSMOS_ENDPOINT ?? "").trim();
  const key = (process.env.AZURE_COSMOS_KEY ?? "").trim();
  return { connectionString, endpoint, key };
}

let cosmosClientForBackup: CosmosClient | null = null;
let cosmosContainerForBackup: Container | null = null;

function getAzureCosmosClientForBackup(): CosmosClient {
  if (cosmosClientForBackup) {
    return cosmosClientForBackup;
  }

  const { connectionString, endpoint, key } = getAzureCosmosCredentials();

  if (connectionString.trim().length > 0) {
    cosmosClientForBackup = new CosmosClient({ connectionString });
    return cosmosClientForBackup;
  }

  if (endpoint.trim().length > 0 && key.trim().length > 0) {
    cosmosClientForBackup = new CosmosClient({ endpoint, key });
    return cosmosClientForBackup;
  }

  throw new HttpsError("failed-precondition", "Azure Cosmos is not configured. Set AZURE_COSMOS_CONNECTION_STRING secret or AZURE_COSMOS_ENDPOINT + AZURE_COSMOS_KEY secrets.");
}

async function getAzureCosmosContainerForBackup(): Promise<Container> {
  if (cosmosContainerForBackup) {
    return cosmosContainerForBackup;
  }

  const client = getAzureCosmosClientForBackup();
  const databaseId = process.env.AZURE_COSMOS_DATABASE_ID?.trim() || DEFAULT_AZURE_COSMOS_DATABASE_ID;
  const containerId = process.env.AZURE_COSMOS_CONTAINER_ID?.trim() || DEFAULT_AZURE_COSMOS_CONTAINER_ID;
  const { database } = await client.databases.createIfNotExists({ id: databaseId });
  const { container } = await database.containers.createIfNotExists({
    id: containerId,
    partitionKey: { paths: ["/collection"] },
  });
  cosmosContainerForBackup = container;
  return container;
}

async function reconcileStaleRunningBackupJobs(): Promise<void> {
  const snapshot = await getBackupJobsCollectionRef().orderBy("startedAt", "desc").limit(30).get();
  const nowMs = Date.now();
  const staleUpdates: Array<{ ref: FirebaseFirestore.DocumentReference; data: Partial<SuperAdminBackupJobResult> }> = [];

  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() as Partial<SuperAdminBackupJobResult>;
    if (data.status !== "running" || typeof data.startedAt !== "string") {
      return;
    }

    const startedMs = Date.parse(data.startedAt);
    if (Number.isNaN(startedMs) || nowMs - startedMs < BACKUP_STALE_RUNNING_MS) {
      return;
    }

    staleUpdates.push({
      ref: docSnap.ref,
      data: {
        status: "failed",
        finishedAt: new Date(nowMs).toISOString(),
        message: "Backup marked stale after exceeding lease window.",
      },
    });
  });

  if (staleUpdates.length === 0) {
    return;
  }

  const batch = firestore.batch();
  staleUpdates.forEach((update) => {
    batch.set(update.ref, update.data, { merge: true });
  });
  await batch.commit();
}

async function acquireBackupRunLease(runId: string, triggeredBy: string): Promise<void> {
  const lockRef = getBackupRuntimeDocRef();
  await firestore.runTransaction(async (transaction) => {
    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const leaseUntilIso = new Date(nowMs + BACKUP_RUN_LEASE_MS).toISOString();

    const snapshot = await transaction.get(lockRef);
    const data = snapshot.data() as Record<string, unknown> | undefined;
    const existingRunId = typeof data?.runId === "string" ? data.runId : "";
    const existingStatus = typeof data?.status === "string" ? data.status : "idle";
    const existingLeaseUntil = typeof data?.leaseUntil === "string" ? Date.parse(data.leaseUntil) : 0;

    if (
      existingStatus === "running"
      && existingRunId
      && existingRunId !== runId
      && Number.isFinite(existingLeaseUntil)
      && existingLeaseUntil > nowMs
    ) {
      throw new HttpsError("failed-precondition", "A backup run is already in progress. Please wait for it to finish.");
    }

    transaction.set(lockRef, {
      runId,
      status: "running",
      triggeredBy,
      startedAt: nowIso,
      leaseUntil: leaseUntilIso,
      updatedAt: nowIso,
    }, { merge: true });
  });
}

async function touchBackupRunLease(runId: string): Promise<void> {
  const lockRef = getBackupRuntimeDocRef();
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    const data = snapshot.data() as Record<string, unknown> | undefined;
    const existingRunId = typeof data?.runId === "string" ? data.runId : "";
    if (existingRunId !== runId) {
      return;
    }

    const now = new Date();
    transaction.set(lockRef, {
      leaseUntil: new Date(now.getTime() + BACKUP_RUN_LEASE_MS).toISOString(),
      updatedAt: now.toISOString(),
    }, { merge: true });
  });
}

async function releaseBackupRunLease(runId: string, finalStatus: "success" | "partial" | "failed"): Promise<void> {
  const lockRef = getBackupRuntimeDocRef();
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    const data = snapshot.data() as Record<string, unknown> | undefined;
    const existingRunId = typeof data?.runId === "string" ? data.runId : "";
    if (existingRunId !== runId) {
      return;
    }

    const nowIso = new Date().toISOString();
    transaction.set(lockRef, {
      runId: null,
      status: "idle",
      leaseUntil: null,
      finishedAt: nowIso,
      lastRunStatus: finalStatus,
      updatedAt: nowIso,
    }, { merge: true });
  });
}

async function runAzureBackupMirror(triggeredBy: string): Promise<SuperAdminBackupJobResult> {
  const startedAt = new Date().toISOString();
  const jobRef = getBackupJobsCollectionRef().doc();

  let docsScanned = 0;
  let docsMirrored = 0;
  let docsFailed = 0;
  let requestUnitsUsed = 0;
  let usedIndexFallback = false;
  const seenPaths = new Set<string>();

  await reconcileStaleRunningBackupJobs();
  await acquireBackupRunLease(jobRef.id, triggeredBy);

  try {
    await jobRef.set({
      id: jobRef.id,
      triggeredBy,
      startedAt,
      finishedAt: null,
      status: "running",
      docsScanned: 0,
      docsMirrored: 0,
      docsFailed: 0,
      requestUnitsUsed: 0,
      message: "Backup request received. Scanning for changed documents.",
    } satisfies SuperAdminBackupJobResult);

    const container = await getAzureCosmosContainerForBackup();
    const backupConfig = normalizeBackupConfig((await getBackupConfigDocRef().get()).data());
    const sinceMillis = backupConfig.lastBackupAt ? Date.parse(backupConfig.lastBackupAt) : 0;
    const sinceIso = new Date(sinceMillis).toISOString();

    for (const collectionName of SUPPORTED_COLLECTIONS) {
      const { snapshots, usedIndexFallback: fallbackForCollection } = await fetchBackupSnapshotsForCollection(collectionName, sinceIso);
      if (fallbackForCollection) {
        usedIndexFallback = true;
      }

      for (const snapshot of snapshots) {
        for (const docSnap of snapshot.docs) {
          if (seenPaths.has(docSnap.ref.path)) {
            continue;
          }

          seenPaths.add(docSnap.ref.path);
          docsScanned += 1;
          const payload = docSnap.data();
          const isoUpdatedAt = toIsoOrNull(payload.updatedAt) ?? toIsoOrNull(payload.lastModified) ?? startedAt;
          if (Date.parse(isoUpdatedAt) <= sinceMillis) {
            continue;
          }

          const mirroredRecord = {
            id: createHash("sha1").update(docSnap.ref.path).digest("hex"),
            collection: collectionName,
            sourcePath: docSnap.ref.path,
            payload,
            updatedAt: isoUpdatedAt,
            mirroredAt: startedAt,
          };

          try {
            const response = await container.items.upsert(mirroredRecord);
            docsMirrored += 1;
            requestUnitsUsed += Number(response.requestCharge ?? 0);
          } catch {
            docsFailed += 1;
          }
        }
      }

      await jobRef.set({
        status: "running",
        docsScanned,
        docsMirrored,
        docsFailed,
        requestUnitsUsed: Number(requestUnitsUsed.toFixed(2)),
        message: `Running backup: scanned ${docsScanned}, mirrored ${docsMirrored}, failed ${docsFailed}.`,
      }, { merge: true });

      await touchBackupRunLease(jobRef.id);
    }

    const status: "success" | "partial" | "failed" = docsFailed === 0
      ? "success"
      : docsMirrored > 0
        ? "partial"
        : "failed";

    const finishedAt = new Date().toISOString();
    const message = status === "success"
      ? `Mirrored ${docsMirrored} changed documents to Azure.`
      : status === "partial"
        ? `Mirrored ${docsMirrored} documents with ${docsFailed} failures.`
        : "No documents were mirrored to Azure.";

    const finalMessage = usedIndexFallback
      ? `${message} Index fallback mode used (timestamp index missing); run may scan extra docs.`
      : message;

    const jobResult: SuperAdminBackupJobResult = {
      id: jobRef.id,
      triggeredBy,
      startedAt,
      finishedAt,
      status,
      docsScanned,
      docsMirrored,
      docsFailed,
      requestUnitsUsed: Number(requestUnitsUsed.toFixed(2)),
      message: finalMessage,
    };

    await jobRef.set(jobResult);
    await getBackupConfigDocRef().set({
      lastBackupAt: finishedAt,
      updatedAt: finishedAt,
      updatedBy: triggeredBy,
    }, { merge: true });

    return jobResult;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const rawMessage = error instanceof Error ? error.message : String(error);
    const failureMessage = rawMessage.trim().length > 0 ? rawMessage : "Backup failed before document mirroring began.";

    await jobRef.set({
      id: jobRef.id,
      triggeredBy,
      startedAt,
      finishedAt,
      status: "failed",
      docsScanned,
      docsMirrored,
      docsFailed,
      requestUnitsUsed: Number(requestUnitsUsed.toFixed(2)),
      message: `Backup failed: ${failureMessage}`,
    } satisfies SuperAdminBackupJobResult);

    console.error("[backup] manual/scheduled mirror failed", { triggeredBy, message: failureMessage });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", `Backup failed: ${failureMessage}`);
  } finally {
    const finalStatus: "success" | "partial" | "failed" = docsMirrored > 0
      ? (docsFailed > 0 ? "partial" : "success")
      : "failed";
    await releaseBackupRunLease(jobRef.id, finalStatus);
  }
}

type AiUsageKind = "screenshot_text" | "image_metadata" | "document_content";
type AiUsageProvider = "openai" | "github";
type GitHubCopilotTier = "free" | "pro" | "business" | "enterprise";

interface AiUsageState {
  aiRequestsToday: number;
  aiTokensToday: number;
  aiExecutionsToday: number;
  aiBucketHitsToday: number;
  aiFailuresToday: number;
  screenshotTextRequestsToday: number;
  imageMetadataRequestsToday: number;
  documentContentRequestsToday: number;
  providerRateLimitedToday: number;
  openAiRequestsToday: number;
  openAiTokensToday: number;
  githubRequestsToday: number;
  githubTokensToday: number;
  openAiRateLimitedToday: number;
  githubRateLimitedToday: number;
  lastResetDate: string;
}

interface AiUsageIncrement {
  kind: AiUsageKind;
  provider?: AiUsageProvider;
  requestCount?: number;
  tokenCount?: number;
  executionCount?: number;
  bucketHitCount?: number;
  failureCount?: number;
  rateLimitedCount?: number;
}

interface OpenAiModelLimitDefaults {
  requestsPerMinute: number | null;
  tokensPerMinute: number | null;
  requestsPerDay: number | null;
  tokensPerDay: number | null;
}

interface OpenAiRateLimitSnapshot {
  model: string;
  capturedAt: string;
  source: "headers" | "defaults";
  requestsPerMinuteLimit: number | null;
  requestsPerMinuteRemaining: number | null;
  requestsResetIn: string | null;
  tokensPerMinuteLimit: number | null;
  tokensPerMinuteRemaining: number | null;
  tokensResetIn: string | null;
  requestsPerDayLimit: number | null;
  tokensPerDayLimit: number | null;
  requestWindowUsedPercent: number | null;
  tokenWindowUsedPercent: number | null;
}

interface AiSafetyPolicyRecord {
  defaultDailyRequestLimit: number;
  defaultDailyTokenLimit: number;
  defaultMonthlyBudgetUsd: number;
  openAiMonthlySpendUsd: number | null;
  githubCopilotTier: GitHubCopilotTier;
  githubDailyRequestLimit: number;
  githubDailyTokenLimit: number;
  githubRequestsPerMinuteLimit: number;
  githubTokensPerRequestInputLimit: number;
  githubTokensPerRequestOutputLimit: number;
  githubConcurrentRequestsLimit: number;
  budgetAlertThresholdPct: number;
  budgetHardStopThresholdPct: number;
  updatedBy: string;
  updatedAt: string;
}

interface AiSafetyOverrideRecord {
  dailyRequestLimit: number | null;
  dailyTokenLimit: number | null;
  monthlyBudgetUsd: number | null;
  githubDailyRequestLimit: number | null;
  githubDailyTokenLimit: number | null;
  updatedBy: string;
  updatedAt: string;
}

interface CurrentAiSafetyStatusResult {
  usage: AiUsageState;
  effectiveLimits: {
    dailyRequestLimit: number;
    dailyTokenLimit: number;
    monthlyBudgetUsd: number;
    githubDailyRequestLimit: number;
    githubDailyTokenLimit: number;
    githubCopilotTier: GitHubCopilotTier;
    githubRequestsPerMinuteLimit: number;
    githubTokensPerRequestInputLimit: number;
    githubTokensPerRequestOutputLimit: number;
    githubConcurrentRequestsLimit: number;
    budgetAlertThresholdPct: number;
    budgetHardStopThresholdPct: number;
    openAiMonthlySpendUsd: number | null;
  };
  dailyRequestUsagePercent: number;
  dailyTokenUsagePercent: number;
  githubDailyRequestUsagePercent: number;
  githubDailyTokenUsagePercent: number;
  monthlyBudgetUsagePercent: number | null;
  hasExceededDailyRequestLimit: boolean;
  hasExceededDailyTokenLimit: boolean;
  hasExceededGithubDailyRequestLimit: boolean;
  hasExceededGithubDailyTokenLimit: boolean;
  hasExceededMonthlyBudgetThreshold: boolean;
}

interface SuperAdminAiProviderLimitsResult {
  provider: "openai";
  capturedAt: string;
  policy: AiSafetyPolicyRecord;
  models: OpenAiRateLimitSnapshot[];
  github: {
    tier: GitHubCopilotTier;
    requestsPerMinuteLimit: number;
    requestsPerDayLimit: number;
    tokensPerRequestInputLimit: number;
    tokensPerRequestOutputLimit: number;
    concurrentRequestsLimit: number;
  };
  githubStatus: {
    isRateLimited: boolean;
    retryAfterSeconds: number | null;
    retryAfterUntil: string | null;
    observedAt: string | null;
  };
  aggregateToday: {
    aiRequestsToday: number;
    aiTokensToday: number;
    aiBucketHitsToday: number;
    aiFailuresToday: number;
    providerRateLimitedToday: number;
    openAiRequestsToday: number;
    openAiTokensToday: number;
    githubRequestsToday: number;
    githubTokensToday: number;
    openAiRateLimitedToday: number;
    githubRateLimitedToday: number;
  };
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

function getOpenAiApiKey(): string {
  const candidates = [
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_KEY,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function getGitHubModelsToken(): string {
  const candidates = [
    process.env.COURSEFORGE_GITHUB_TOKEN,
    process.env.GITHUB_TOKEN,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

type ProviderAvailabilityState = "available" | "unavailable" | "unknown";

interface CloudOcrExecutionDetails {
  traceId: string;
  endpoint: string;
  model: string;
  requestAcceptedByFunction: boolean;
  providerRequestPrepared: boolean;
  providerRequestSent: boolean;
  providerResponseReceived: boolean;
  providerExecutionObserved: boolean;
  failureStage: string | null;
}

interface CloudOcrProbeResult {
  available: boolean;
  availabilityState: ProviderAvailabilityState;
  reasonCode: string;
  reasonMessage: string;
  httpStatus: number | null;
  retryAfterSeconds: number | null;
  details: CloudOcrExecutionDetails;
}

interface CloudOcrProviderRuntime {
  id: "cloud_openai_vision" | "cloud_github_models_vision";
  label: string;
  endpoint: string;
  model: string;
  apiKey: string;
  missingCredentialReason: string;
  headers?: Record<string, string>;
}

async function readResponseSnippet(response: Response): Promise<string> {
  try {
    const rawText = (await response.text()).trim();
    if (!rawText) {
      return "";
    }

    try {
      const parsed = JSON.parse(rawText) as { error?: { message?: unknown }; message?: unknown };
      const errorMessage = typeof parsed?.error?.message === "string"
        ? parsed.error.message.trim()
        : typeof parsed?.message === "string"
          ? parsed.message.trim()
          : "";
      if (errorMessage) {
        return errorMessage.slice(0, 240);
      }
    } catch {
      // Fall back to truncated plain text response.
    }

    return rawText.slice(0, 240);
  } catch {
    return "";
  }
}

function createCloudOcrExecutionDetails(runtime: CloudOcrProviderRuntime, traceId: string): CloudOcrExecutionDetails {
  return {
    traceId,
    endpoint: runtime.endpoint,
    model: runtime.model,
    requestAcceptedByFunction: true,
    providerRequestPrepared: false,
    providerRequestSent: false,
    providerResponseReceived: false,
    providerExecutionObserved: false,
    failureStage: null,
  };
}

async function probeCloudOcrProvider(runtime: CloudOcrProviderRuntime): Promise<CloudOcrProbeResult> {
  const traceId = `ocr-probe-${runtime.id}-${Date.now()}`;
  const details = createCloudOcrExecutionDetails(runtime, traceId);

  if (!runtime.apiKey.trim()) {
    details.failureStage = "preflight_credentials";
    return {
      available: false,
      availabilityState: "unavailable",
      reasonCode: runtime.id === "cloud_openai_vision" ? "missing_openai_api_key" : "missing_github_models_token",
      reasonMessage: runtime.missingCredentialReason,
      httpStatus: null,
      retryAfterSeconds: null,
      details,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 6500);

  try {
    details.providerRequestPrepared = true;
    details.providerRequestSent = true;
    const response = await fetch(runtime.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.apiKey}`,
        ...(runtime.headers ?? {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: runtime.model,
        messages: [
          {
            role: "user",
            content: "Respond with: ok",
          },
        ],
        max_tokens: 4,
        temperature: 0,
      }),
    });

    details.providerResponseReceived = true;
    details.providerExecutionObserved = true;
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers);

    if (response.ok) {
      if (runtime.id === "cloud_github_models_vision") {
        void recordGitHubRateLimitStatusBestEffort({
          isRateLimited: false,
          retryAfterSeconds: null,
          source: "probeCloudOcrProvider:success",
        });
      }
      return {
        available: true,
        availabilityState: "available",
        reasonCode: "ok",
        reasonMessage: `${runtime.label} authentication probe succeeded.`,
        httpStatus: response.status,
        retryAfterSeconds,
        details,
      };
    }

    if (response.status === 429) {
      if (runtime.id === "cloud_github_models_vision") {
        void recordGitHubRateLimitStatusBestEffort({
          isRateLimited: true,
          retryAfterSeconds,
          source: "probeCloudOcrProvider:429",
        });
      }
      return {
        available: false,
        availabilityState: "unavailable",
        reasonCode: "rate_limited",
        reasonMessage: `${runtime.label} is not currently usable because the provider returned 429 rate limiting or quota exhaustion.`,
        httpStatus: response.status,
        retryAfterSeconds,
        details,
      };
    }

    const snippet = await readResponseSnippet(response);
    details.failureStage = "provider_response";

    if (response.status === 401 || response.status === 403) {
      const lowered = snippet.toLowerCase();
      if (
        response.status === 403
        && (
          lowered.includes("no access to model")
          || lowered.includes("no_access")
          || lowered.includes("model_not_enabled")
        )
      ) {
        return {
          available: false,
          availabilityState: "unavailable",
          reasonCode: "model_access_denied",
          reasonMessage: snippet || `${runtime.label} credentials are valid, but this account has no access to the configured model.`,
          httpStatus: response.status,
          retryAfterSeconds,
          details,
        };
      }

      return {
        available: false,
        availabilityState: "unavailable",
        reasonCode: "auth_failed",
        reasonMessage: snippet || `${runtime.label} rejected credentials for OCR requests.`,
        httpStatus: response.status,
        retryAfterSeconds,
        details,
      };
    }

    if (response.status === 400 || response.status === 404 || response.status === 422) {
      return {
        available: false,
        availabilityState: "unavailable",
        reasonCode: "request_rejected",
        reasonMessage: snippet || `${runtime.label} rejected the probe request with status ${response.status}.`,
        httpStatus: response.status,
        retryAfterSeconds,
        details,
      };
    }

    if (response.status >= 500) {
      return {
        available: false,
        availabilityState: "unknown",
        reasonCode: "provider_unreachable",
        reasonMessage: snippet || `${runtime.label} returned ${response.status}.`,
        httpStatus: response.status,
        retryAfterSeconds,
        details,
      };
    }

    return {
      available: false,
      availabilityState: "unknown",
      reasonCode: "probe_failed",
      reasonMessage: snippet || `${runtime.label} health probe failed with status ${response.status}.`,
      httpStatus: response.status,
      retryAfterSeconds,
      details,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = message.toLowerCase().includes("abort");
    details.failureStage = timedOut ? "provider_timeout" : "provider_request";
    return {
      available: false,
      availabilityState: "unknown",
      reasonCode: timedOut ? "probe_timeout" : "probe_network_error",
      reasonMessage: timedOut
        ? `${runtime.label} health probe timed out.`
        : `${runtime.label} health probe failed before a provider response: ${message}`,
      httpStatus: null,
      retryAfterSeconds: null,
      details,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function canAuthenticateOpenAi(apiKey: string): Promise<CloudOcrProbeResult> {
  return probeCloudOcrProvider({
    id: "cloud_openai_vision",
    label: "Cloud OCR (OpenAI Vision via Firebase Function)",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    apiKey,
    missingCredentialReason: "OPENAI_API_KEY is not configured on the function runtime.",
  });
}

async function canAuthenticateGitHubModels(apiKey: string): Promise<CloudOcrProbeResult> {
  return probeCloudOcrProvider({
    id: "cloud_github_models_vision",
    label: "Cloud OCR (GitHub Models Vision)",
    endpoint: "https://models.github.ai/inference/chat/completions",
    model: "openai/gpt-4.1",
    apiKey,
    missingCredentialReason: "COURSEFORGE_GITHUB_TOKEN or GITHUB_TOKEN is not configured on the function runtime.",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });
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

type AutoOcrProviderId = 
  | "local_tesseract" 
  | "cloud_openai_vision"
  | "cloud_github_models_vision";

interface AiProviderPolicyRecord {
  providerOrder: AutoOcrProviderId[];
  updatedBy: string;
  updatedAt: string;
}

interface DebugLoggingPolicyRecord {
  enabledGlobally: boolean;
  disabledUserIds: string[];
  maxUploadBytes: number;
  maxLocalLogBytes: number;
  updatedBy: string;
  updatedAt: string;
}

interface DebugLogEntryRecord {
  id: string;
  timestamp: number;
  eventType: string;
  message: string;
  context?: Record<string, unknown>;
  errorStack?: string;
  autoModeStep?: string;
  captureMetadata?: {
    width?: number;
    height?: number;
    dpi?: number;
    fileSizeBytes?: number;
  };
  sizeBytes: number;
}

interface DebugUploadSummary {
  reportPath: string;
  userId: string;
  createdAt: string;
  uploadedAtMs: number;
  totalSizeBytes: number;
  entriesCount: number;
  appVersion?: string;
}

type MetadataPageType = "cover" | "title" | "other";

interface MetadataResultRecord {
  title: string | null;
  subtitle: string | null;
  edition: string | null;
  publisher: string | null;
  publisherLocation?: string | null;
  series: string | null;
  gradeLevel: string | null;
  subject: string | null;
  copyrightYear?: number | null;
  isbn?: string | null;
  additionalIsbns?: string[];
  relatedIsbns?: Array<{ isbn: string; type: string; note?: string }>;
  platformUrl?: string | null;
  mhid?: string | null;
  confidence: number;
  rawText: string;
  source: "vision" | "ocr" | "vision+ocr";
}

interface MetadataCorrectionRecord {
  id: string;
  timestamp: string;
  pageType: MetadataPageType;
  publisher: string | null;
  series: string | null;
  subject: string | null;
  originalVisionOutput: MetadataResultRecord | null;
  originalOcrOutput: {
    rawText: string;
  } | null;
  finalMetadata: MetadataResultRecord;
  imageReference: string | null;
  flagged: boolean;
  reasonFlagged?: string;
  finalConfidence: number;
  errorScore: number;
  reviewedByAdmin?: string | null;
  reviewStatus: "pending" | "accepted" | "rejected";
}

interface MetadataCorrectionRulesRecord {
  version: string;
  updatedAt: string;
  globalReplacements: Array<{ from: string; to: string }>;
  publisherSpecific: {
    [publisherName: string]: {
      replacements: Array<{ from: string; to: string }>;
      patterns?: Array<{ pattern: string; replacement: string }>;
    };
  };
}

function success<T>(message: string, data: T): CallableResult<T> {
  return { success: true, message, data };
}

function assertAdmin(authData: { token?: Record<string, unknown> } | null | undefined): void {
  if (!authData) {
    throw new HttpsError("unauthenticated", "You must be signed in to use admin functions.");
  }

  if (authData.token?.admin !== true && authData.token?.superAdmin !== true) {
    throw new HttpsError("permission-denied", "Admin privileges are required for this action.");
  }
}

function assertSignedIn(authData: { uid?: string; token?: Record<string, unknown> } | null | undefined): asserts authData is { uid: string; token?: Record<string, unknown> } {
  if (!authData?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
}

function isSuperAdminToken(authData: { token?: Record<string, unknown> } | null | undefined): boolean {
  return authData?.token?.superAdmin === true;
}

function normalizeIdentity(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getConfiguredOwnerSuperAdminEmails(): Set<string> {
  const values = new Set<string>();
  const csv = typeof process.env.COURSEFORGE_OWNER_SUPERADMIN_EMAILS === "string"
    ? process.env.COURSEFORGE_OWNER_SUPERADMIN_EMAILS
    : "";

  csv.split(",").forEach((entry) => {
    const normalized = normalizeIdentity(entry);
    if (normalized) {
      values.add(normalized);
    }
  });

  const fallback = normalizeIdentity(process.env.COURSEFORGE_OWNER_EMAIL);
  if (fallback) {
    values.add(fallback);
  }

  return values;
}

function getConfiguredOwnerSuperAdminUids(): Set<string> {
  const values = new Set<string>();
  const csv = typeof process.env.COURSEFORGE_OWNER_SUPERADMIN_UIDS === "string"
    ? process.env.COURSEFORGE_OWNER_SUPERADMIN_UIDS
    : "";

  csv.split(",").forEach((entry) => {
    const normalized = entry.trim();
    if (normalized) {
      values.add(normalized);
    }
  });

  return values;
}

function assertOwnerSuperAdminOperator(authData: { uid?: string; token?: Record<string, unknown> } | null | undefined): asserts authData is { uid: string; token?: Record<string, unknown> } {
  assertSignedIn(authData);

  const ownerEmails = getConfiguredOwnerSuperAdminEmails();
  const ownerUids = getConfiguredOwnerSuperAdminUids();
  if (ownerEmails.size === 0 && ownerUids.size === 0) {
    throw new HttpsError(
      "failed-precondition",
      "Owner super-admin allowlist is not configured. Set COURSEFORGE_OWNER_SUPERADMIN_EMAILS and/or COURSEFORGE_OWNER_SUPERADMIN_UIDS."
    );
  }

  const callerUid = authData.uid.trim();
  const callerEmail = normalizeIdentity(authData.token?.email);
  const callerAllowed = ownerUids.has(callerUid) || (callerEmail ? ownerEmails.has(callerEmail) : false);
  if (!callerAllowed) {
    throw new HttpsError("permission-denied", "Only the owner account may manage super admin access.");
  }

  if (authData.token?.superAdmin !== true && authData.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Owner account must hold admin privileges to manage super admin access.");
  }
}

function assertSuperAdmin(authData: { token?: Record<string, unknown> } | null | undefined): void {
  if (!authData) {
    throw new HttpsError("unauthenticated", "You must be signed in to use super admin functions.");
  }

  if (!isSuperAdminToken(authData)) {
    throw new HttpsError("permission-denied", "Super admin privileges are required for this action.");
  }
}

function assertSchoolAdmin(authData: { token?: Record<string, unknown> } | null | undefined): void {
  if (!authData) {
    throw new HttpsError("unauthenticated", "You must be signed in to use school admin functions.");
  }

  if (authData.token?.admin === true || authData.token?.superAdmin === true || authData.token?.schoolAdmin === true) {
    return;
  }

  throw new HttpsError("permission-denied", "School admin privileges are required for this action.");
}

function normalizeSchoolId(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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
const AI_PROVIDER_POLICY_DOC_PATH = "config/aiProviderPolicy";
const AI_SAFETY_POLICY_DOC_PATH = "config/aiSafetyPolicy";
const AI_PROVIDER_STATUS_DOC_PATH = "config/aiProviderStatus";
const DEBUG_POLICY_DOC_PATH = "config/debugLoggingPolicy";
const METADATA_CORRECTION_RULES_DOC_PATH = "config/metadataCorrectionRules";
const METADATA_CORRECTION_LIMITS_DOC_PATH = "config/metadataCorrectionLimits";
const METADATA_CORRECTION_AUDIT_COLLECTION = "metadataCorrectionAuditLogs";
const DEFAULT_AUTO_OCR_PROVIDER_ORDER: AutoOcrProviderId[] = [
  "cloud_openai_vision",
  "cloud_github_models_vision",
  "local_tesseract",
];
const DEFAULT_DEBUG_POLICY: DebugLoggingPolicyRecord = {
  enabledGlobally: true,
  disabledUserIds: [],
  maxUploadBytes: 500 * 1024,
  maxLocalLogBytes: 1_500_000,
  updatedBy: "system",
  updatedAt: new Date(0).toISOString(),
};
const OCR_RATE_LIMIT_WINDOW_MS = 60_000;
const OCR_RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_OCR_IMAGE_DATA_URL_BYTES = 8 * 1024 * 1024;
const DEFAULT_USER_AI_DAILY_REQUEST_LIMIT = 120;
const DEFAULT_USER_AI_DAILY_TOKEN_LIMIT = 120_000;
const DEFAULT_OPENAI_MONTHLY_BUDGET_USD = 10;
const DEFAULT_OPENAI_BUDGET_ALERT_THRESHOLD_PCT = 80;
const DEFAULT_OPENAI_BUDGET_HARD_STOP_PCT = 100;
const DEFAULT_GITHUB_COPILOT_TIER: GitHubCopilotTier = "free";
const OPENAI_RATE_LIMIT_DOC_ROOT = "providerRateLimits/openai/models";
const OPENAI_MODEL_LIMIT_DEFAULTS: Record<string, OpenAiModelLimitDefaults> = {
  "gpt-4o-mini": {
    requestsPerMinute: 500,
    tokensPerMinute: 200_000,
    requestsPerDay: 10_000,
    tokensPerDay: 2_000_000,
  },
  "gpt-4.1": {
    requestsPerMinute: 500,
    tokensPerMinute: 30_000,
    requestsPerDay: null,
    tokensPerDay: 900_000,
  },
};
const GITHUB_COPILOT_TIER_LIMITS: Record<GitHubCopilotTier, {
  requestsPerMinuteLimit: number;
  requestsPerDayLimit: number;
  tokensPerRequestInputLimit: number;
  tokensPerRequestOutputLimit: number;
  concurrentRequestsLimit: number;
}> = {
  free: {
    requestsPerMinuteLimit: 10,
    requestsPerDayLimit: 50,
    tokensPerRequestInputLimit: 8_000,
    tokensPerRequestOutputLimit: 4_000,
    concurrentRequestsLimit: 2,
  },
  pro: {
    requestsPerMinuteLimit: 10,
    requestsPerDayLimit: 50,
    tokensPerRequestInputLimit: 8_000,
    tokensPerRequestOutputLimit: 4_000,
    concurrentRequestsLimit: 2,
  },
  business: {
    requestsPerMinuteLimit: 10,
    requestsPerDayLimit: 100,
    tokensPerRequestInputLimit: 8_000,
    tokensPerRequestOutputLimit: 4_000,
    concurrentRequestsLimit: 2,
  },
  enterprise: {
    requestsPerMinuteLimit: 15,
    requestsPerDayLimit: 150,
    tokensPerRequestInputLimit: 16_000,
    tokensPerRequestOutputLimit: 8_000,
    concurrentRequestsLimit: 4,
  },
};
const DEFAULT_CORRECTION_DAILY_LIMIT = 25;
const DEFAULT_CORRECTION_MAX_IMAGE_BYTES = 200 * 1024;
const DEFAULT_CORRECTION_MIN_UPLOAD_INTERVAL_SECONDS = 5;

function roundToOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function normalizeAutoOcrProviderOrder(value: unknown): AutoOcrProviderId[] {
  if (!Array.isArray(value)) {
    return DEFAULT_AUTO_OCR_PROVIDER_ORDER;
  }

  const accepted = value.filter((entry): entry is AutoOcrProviderId => (
    entry === "local_tesseract"
    || entry === "cloud_openai_vision"
    || entry === "cloud_github_models_vision"
  ));
  const unique = accepted.filter((entry, index, array) => array.indexOf(entry) === index);
  const selectedCloudProviders = unique.filter((entry): entry is Exclude<AutoOcrProviderId, "local_tesseract"> => entry !== "local_tesseract");

  if (!selectedCloudProviders.length) {
    return DEFAULT_AUTO_OCR_PROVIDER_ORDER;
  }

  const normalized: AutoOcrProviderId[] = [...selectedCloudProviders];
  for (const provider of DEFAULT_AUTO_OCR_PROVIDER_ORDER) {
    if (provider !== "local_tesseract" && !normalized.includes(provider)) {
      normalized.push(provider);
    }
  }

  normalized.push("local_tesseract");
  return normalized;
}

function normalizeDebugLoggingPolicy(value: unknown): DebugLoggingPolicyRecord {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const disabledUserIds = Array.isArray(data.disabledUserIds)
    ? data.disabledUserIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  const maxUploadBytesRaw = typeof data.maxUploadBytes === "number" ? data.maxUploadBytes : DEFAULT_DEBUG_POLICY.maxUploadBytes;
  const maxLocalLogBytesRaw = typeof data.maxLocalLogBytes === "number" ? data.maxLocalLogBytes : DEFAULT_DEBUG_POLICY.maxLocalLogBytes;

  return {
    enabledGlobally: data.enabledGlobally !== false,
    disabledUserIds: disabledUserIds.slice(0, 500),
    maxUploadBytes: Math.max(64 * 1024, Math.min(2 * 1024 * 1024, Math.round(maxUploadBytesRaw))),
    maxLocalLogBytes: Math.max(256 * 1024, Math.min(4 * 1024 * 1024, Math.round(maxLocalLogBytesRaw))),
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : DEFAULT_DEBUG_POLICY.updatedBy,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : DEFAULT_DEBUG_POLICY.updatedAt,
  };
}

async function getDebugLoggingPolicyRecord(): Promise<DebugLoggingPolicyRecord> {
  const snapshot = await firestore.doc(DEBUG_POLICY_DOC_PATH).get();
  if (!snapshot.exists) {
    return DEFAULT_DEBUG_POLICY;
  }

  return normalizeDebugLoggingPolicy(snapshot.data());
}

function sanitizeDebugLogEntries(value: unknown): DebugLogEntryRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): DebugLogEntryRecord | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const timestamp = typeof record.timestamp === "number" ? record.timestamp : 0;
      const eventType = typeof record.eventType === "string" ? record.eventType : "info";
      const message = typeof record.message === "string" ? record.message : "";
      const sizeBytes = typeof record.sizeBytes === "number" ? record.sizeBytes : 0;

      if (!id || !message || timestamp <= 0 || sizeBytes <= 0) {
        return null;
      }

      return {
        id,
        timestamp,
        eventType,
        message,
        context: typeof record.context === "object" && record.context !== null ? record.context as Record<string, unknown> : undefined,
        errorStack: typeof record.errorStack === "string" ? record.errorStack : undefined,
        autoModeStep: typeof record.autoModeStep === "string" ? record.autoModeStep : undefined,
        captureMetadata: typeof record.captureMetadata === "object" && record.captureMetadata !== null
          ? record.captureMetadata as DebugLogEntryRecord["captureMetadata"]
          : undefined,
        sizeBytes,
      };
    })
    .filter((entry): entry is DebugLogEntryRecord => entry !== null);
}

const VALID_SUBJECTS = new Set(["ELA", "Math", "Science", "History", "Social Studies", "Art", "Music", "Physical Education", "Computer Science", "Foreign Language", "Other"]);

/** Extract the first ISBN-13 or ISBN-10 from free-form text. */
function extractIsbnFromText(text: string): string | null {
  const match = text.match(/(?:isbn[^0-9]*)?(97[89][\d\-\s]{10,20}|\b\d{9}[\dXx]\b)/i);
  if (match?.[1]) {
    const normalized = match[1].replace(/[^0-9Xx]/g, "").toUpperCase();
    return (normalized.length === 10 || normalized.length === 13) ? normalized : null;
  }
  return null;
}

/** Extract MHID from free-form text. */
function extractMhidFromText(text: string): string | null {
  const match = text.match(/\bmhid\b[^A-Z0-9]{0,8}([A-Z0-9][A-Z0-9\-]{4,})/i);
  return match?.[1]?.trim() ?? null;
}

/** Extract the first publisher/platform URL from free-form text. */
function extractPlatformUrlFromText(text: string): string | null {
  const match = text.match(/\b(https?:\/\/[a-z0-9.-]+(?:\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?|www\.[a-z0-9.-]+(?:\/[A-Za-z0-9._/?-]*)?|[a-z0-9.-]+\.[a-z]{2,}(?:\/[A-Za-z0-9._/?-]*)?)/i);
  if (match?.[1]) {
    const trimmed = match[1].replace(/[),.;:"'`]+$/, "").trim();
    if (!trimmed.includes(".")) {
      return null;
    }
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }
  return null;
}

/** Extract copyright year from free-form text. */
function extractCopyrightYearFromText(text: string): number | null {
  const match = text.match(/(?:copyright|Â©)[^\d]{0,12}((?:19|20)\d{2})/i) ?? text.match(/\b((?:19|20)\d{2})\b/);
  if (match?.[1]) {
    const year = Number.parseInt(match[1], 10);
    if (year >= 1900 && year <= new Date().getFullYear() + 5) {
      return year;
    }
  }
  return null;
}

/** Extract publisher address block following "Send all inquiries to:" from free-form text. */
function extractPublisherLocationFromText(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const idx = lines.findIndex((l) => /^send all inquiries\s*to\s*[:\-]?/i.test(l));
  if (idx < 0) {
    return null;
  }
  const addressLines: string[] = [];
  for (let i = idx + 1; i < lines.length && i <= idx + 8; i++) {
    const l = lines[i];
    if (!l) {
      if (addressLines.length > 0) break;
      continue;
    }
    if (/^isbn\b|^mhid\b|^printed in|^copyright|^all rights reserved|^no part of this/i.test(l)) break;
    addressLines.push(l);
  }
  return addressLines.length > 0 ? addressLines.join("\n") : null;
}

function sanitizeMetadataResult(value: unknown, source: MetadataResultRecord["source"]): MetadataResultRecord {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const asText = (field: string): string | null => {
    const raw = data[field];
    if (typeof raw !== "string") {
      return null;
    }

    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  };

  // Enhanced ISBN extraction: handle various formats
  const extractIsbn = (): string | null => {
    const raw = asText("isbn");
    if (!raw) {
      return null;
    }
    // Remove common separators and convert to standard format
    const normalized = raw.replace(/[^0-9Xx]/g, "").toUpperCase();
    return (normalized.length === 10 || normalized.length === 13) ? normalized : null;
  };

  // Enhanced copyright year extraction: handle both string and number
  const extractCopyrightYear = (): number | null => {
    if (typeof data.copyrightYear === "number" && Number.isInteger(data.copyrightYear)) {
      return data.copyrightYear;
    }
    if (typeof data.copyrightYear === "string") {
      const parsed = Number.parseInt(data.copyrightYear.trim(), 10);
      if (Number.isInteger(parsed) && parsed >= 1900 && parsed <= new Date().getFullYear() + 5) {
        return parsed;
      }
    }
    return null;
  };

  const confidenceRaw = typeof data.confidence === "number" ? data.confidence : 0;
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;

  const rawSubject = asText("subject");
  const subject = rawSubject && VALID_SUBJECTS.has(rawSubject) ? rawSubject : null;

  // Backfill structured identifiers from rawText when the model returned them only as free-form text.
  const rawTextStr = typeof data.rawText === "string" ? data.rawText.trim() : "";
  const isbnValue = extractIsbn() ?? (rawTextStr ? extractIsbnFromText(rawTextStr) : null);
  const mhidValue = asText("mhid") ?? (rawTextStr ? extractMhidFromText(rawTextStr) : null);
  const platformUrlValue = asText("platformUrl") ?? (rawTextStr ? extractPlatformUrlFromText(rawTextStr) : null);
  const copyrightYearValue = extractCopyrightYear() ?? (rawTextStr ? extractCopyrightYearFromText(rawTextStr) : null);
  const publisherLocationValue = asText("publisherLocation") ?? (rawTextStr ? extractPublisherLocationFromText(rawTextStr) : null);

  return {
    title: asText("title"),
    subtitle: asText("subtitle"),
    edition: asText("edition"),
    publisher: asText("publisher"),
    publisherLocation: publisherLocationValue,
    series: asText("series"),
    gradeLevel: asText("gradeLevel"),
    subject,
    copyrightYear: copyrightYearValue,
    isbn: isbnValue,
    additionalIsbns: Array.isArray(data.additionalIsbns)
      ? data.additionalIsbns.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => {
          const normalized = entry.replace(/[^0-9Xx]/g, "").toUpperCase();
          return (normalized.length === 10 || normalized.length === 13) ? normalized : null;
        }).filter((x): x is string => x !== null)
      : undefined,
    relatedIsbns: Array.isArray(data.relatedIsbns)
      ? data.relatedIsbns.reduce<Array<{ isbn: string; type: string; note?: string }>>((accumulator, entry) => {
          if (!entry || typeof entry !== "object") {
            return accumulator;
          }

          const typedEntry = entry as { isbn?: unknown; type?: unknown; note?: unknown };
          if (typeof typedEntry.isbn !== "string" || typeof typedEntry.type !== "string") {
            return accumulator;
          }

          const normalizedIsbn = typedEntry.isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
          if (normalizedIsbn.length !== 10 && normalizedIsbn.length !== 13) {
            return accumulator;
          }

          const note = typeof typedEntry.note === "string" && typedEntry.note.trim().length > 0
            ? typedEntry.note.trim()
            : undefined;

          accumulator.push({
            isbn: normalizedIsbn,
            type: typedEntry.type.trim(),
            note,
          });
          return accumulator;
        }, [])
      : undefined,
    platformUrl: platformUrlValue,
    mhid: mhidValue,
    confidence,
    rawText: typeof data.rawText === "string" ? data.rawText : "",
    source,
  };
}

function sanitizeMetadataCorrectionRecords(value: unknown): MetadataCorrectionRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): MetadataCorrectionRecord | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const timestamp = typeof record.timestamp === "string" ? record.timestamp : "";
      const pageType = record.pageType === "cover" || record.pageType === "title" || record.pageType === "other"
        ? record.pageType
        : "other";

      if (!id || !timestamp) {
        return null;
      }

      const finalMetadata = sanitizeMetadataResult(record.finalMetadata, "vision+ocr");
      const finalConfidenceRaw = typeof record.finalConfidence === "number" ? record.finalConfidence : finalMetadata.confidence;
      const finalConfidence = Number.isFinite(finalConfidenceRaw) ? Math.max(0, Math.min(1, finalConfidenceRaw)) : finalMetadata.confidence;
      const visionConfidence = record.originalVisionOutput
        ? sanitizeMetadataResult(record.originalVisionOutput, "vision").confidence
        : finalConfidence;
      const errorScoreRaw = typeof record.errorScore === "number"
        ? record.errorScore
        : Math.abs(visionConfidence - finalConfidence);
      const errorScore = Number.isFinite(errorScoreRaw) ? Math.max(0, Math.min(1, errorScoreRaw)) : 0;
      const flagged = Boolean(record.flagged);
      const reasonFlagged = typeof record.reasonFlagged === "string" && record.reasonFlagged.trim()
        ? record.reasonFlagged.trim()
        : undefined;
      const reviewStatus = record.reviewStatus === "accepted" || record.reviewStatus === "rejected" || record.reviewStatus === "pending"
        ? record.reviewStatus
        : "pending";

      return {
        id,
        timestamp,
        pageType,
        publisher: typeof record.publisher === "string" && record.publisher.trim() ? record.publisher.trim() : null,
        series: typeof record.series === "string" && record.series.trim() ? record.series.trim() : null,
        subject: typeof record.subject === "string" && record.subject.trim() ? record.subject.trim() : null,
        originalVisionOutput: record.originalVisionOutput
          ? sanitizeMetadataResult(record.originalVisionOutput, "vision")
          : null,
        originalOcrOutput: typeof record.originalOcrOutput === "object" && record.originalOcrOutput !== null
          ? {
              rawText: typeof (record.originalOcrOutput as Record<string, unknown>).rawText === "string"
                ? (record.originalOcrOutput as Record<string, unknown>).rawText as string
                : "",
            }
          : null,
        finalMetadata,
        imageReference: typeof record.imageReference === "string" && record.imageReference.trim()
          ? record.imageReference.trim()
          : null,
        flagged,
        reasonFlagged,
        finalConfidence,
        errorScore,
        reviewedByAdmin: typeof record.reviewedByAdmin === "string" && record.reviewedByAdmin.trim()
          ? record.reviewedByAdmin.trim()
          : null,
        reviewStatus,
      };
    })
    .filter((entry): entry is MetadataCorrectionRecord => entry !== null)
    .slice(-200);
}

function normalizePublisherRuleKey(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeMetadataCorrectionRules(value: unknown): MetadataCorrectionRulesRecord {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const globalReplacements = Array.isArray(data.globalReplacements)
    ? data.globalReplacements
      .filter((entry) => typeof (entry as { from?: unknown })?.from === "string" && typeof (entry as { to?: unknown })?.to === "string")
      .map((entry) => ({
        from: ((entry as { from: string }).from).trim(),
        to: ((entry as { to: string }).to).trim(),
      }))
      .filter((entry) => entry.from && entry.to && entry.from !== entry.to)
      .slice(0, 200)
    : [];

  const publisherSpecificRaw = typeof data.publisherSpecific === "object" && data.publisherSpecific !== null
    ? data.publisherSpecific as Record<string, unknown>
    : {};

  const publisherSpecific: MetadataCorrectionRulesRecord["publisherSpecific"] = {};
  for (const [publisher, valueEntry] of Object.entries(publisherSpecificRaw)) {
    const normalizedPublisher = normalizePublisherRuleKey(publisher);
    if (!normalizedPublisher) {
      continue;
    }

    const entry = valueEntry as { replacements?: unknown; patterns?: unknown };
    const replacements = Array.isArray(entry.replacements)
      ? entry.replacements
        .filter((item) => typeof (item as { from?: unknown })?.from === "string" && typeof (item as { to?: unknown })?.to === "string")
        .map((item) => ({
          from: ((item as { from: string }).from).trim(),
          to: ((item as { to: string }).to).trim(),
        }))
        .filter((item) => item.from && item.to && item.from !== item.to)
        .slice(0, 100)
      : [];

    if (!replacements.length) {
      continue;
    }

    publisherSpecific[normalizedPublisher] = { replacements };
  }

  return {
    version: typeof data.version === "string" ? data.version : "1",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    globalReplacements,
    publisherSpecific,
  };
}

function estimateImageReferenceBytes(imageReference: string | null): number {
  if (!imageReference) {
    return 0;
  }

  if (imageReference.startsWith("data:image/")) {
    const commaIndex = imageReference.indexOf(",");
    if (commaIndex >= 0) {
      const base64 = imageReference.slice(commaIndex + 1);
      return Math.ceil((base64.length * 3) / 4);
    }
  }

  return Buffer.byteLength(imageReference, "utf8");
}

function validateCorrectionForQueue(record: MetadataCorrectionRecord): { valid: boolean; reason?: string } {
  if (!record.finalMetadata.title || !record.finalMetadata.title.trim()) {
    return { valid: false, reason: "Title is required." };
  }

  if (!record.originalVisionOutput && !record.originalOcrOutput) {
    return { valid: false, reason: "At least one source output is required." };
  }

  if (!record.imageReference) {
    return { valid: false, reason: "Image snippet reference is required." };
  }

  const imageRef = record.imageReference.trim();
  const imageReferenceValid = imageRef.startsWith("data:image/")
    || imageRef.startsWith("hash://")
    || imageRef.startsWith("blob:")
    || imageRef.startsWith("https://")
    || imageRef.startsWith("http://");

  if (!imageReferenceValid) {
    return { valid: false, reason: "Image snippet reference is invalid." };
  }

  if (estimateImageReferenceBytes(record.imageReference) > DEFAULT_CORRECTION_MAX_IMAGE_BYTES) {
    return { valid: false, reason: `Image snippet exceeds ${DEFAULT_CORRECTION_MAX_IMAGE_BYTES} bytes.` };
  }

  return { valid: true };
}

function detectSuspiciousCorrection(record: MetadataCorrectionRecord): { suspicious: boolean; reason?: string } {
  const combined = [
    record.finalMetadata.title,
    record.finalMetadata.subtitle,
    record.finalMetadata.publisher,
    record.finalMetadata.series,
    record.finalMetadata.subject,
    record.finalMetadata.rawText,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");

  const randomLikeRuns = (combined.match(/[A-Za-z0-9]{10,}/g) ?? []).filter((entry) => !/[aeiou]/i.test(entry));
  if (randomLikeRuns.length >= 3) {
    return { suspicious: true, reason: "Contains excessive random character sequences." };
  }

  const symbolRatio = (combined.match(/[^A-Za-z0-9\s]/g) ?? []).length / Math.max(1, combined.length);
  if (symbolRatio > 0.28) {
    return { suspicious: true, reason: "Contains too many non-text symbols for textbook metadata." };
  }

  const publisher = (record.finalMetadata.publisher ?? "").toLowerCase();
  const priorPublisher = (record.originalVisionOutput?.publisher ?? "").toLowerCase();
  if (publisher && priorPublisher && publisher !== priorPublisher) {
    const looksNonsense = publisher.length < 3 || !/[aeiou]/.test(publisher) || /[0-9]{3,}/.test(publisher);
    if (looksNonsense) {
      return { suspicious: true, reason: "Publisher overwrite appears to be nonsense." };
    }
  }

  return { suspicious: false };
}

function filterAndSortCorrections(
  records: MetadataCorrectionRecord[],
  query: {
    publisher?: string;
    pageType?: string;
    confidenceMin?: number;
    confidenceMax?: number;
    source?: string;
    flaggedOnly?: boolean;
    reviewStatus?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: "timestamp" | "errorScore" | "finalConfidence";
    sortDirection?: "asc" | "desc";
  }
): MetadataCorrectionRecord[] {
  const filtered = records.filter((record) => {
    if (query.publisher && normalizePublisherRuleKey(record.publisher) !== normalizePublisherRuleKey(query.publisher)) {
      return false;
    }

    if (query.pageType && query.pageType !== "all" && record.pageType !== query.pageType) {
      return false;
    }

    if (query.source && query.source !== "all" && record.finalMetadata.source !== query.source) {
      return false;
    }

    if (query.flaggedOnly && !record.flagged) {
      return false;
    }

    if (query.reviewStatus && query.reviewStatus !== "all" && record.reviewStatus !== query.reviewStatus) {
      return false;
    }

    if (typeof query.confidenceMin === "number" && record.finalConfidence < query.confidenceMin) {
      return false;
    }

    if (typeof query.confidenceMax === "number" && record.finalConfidence > query.confidenceMax) {
      return false;
    }

    if (query.dateFrom && record.timestamp < query.dateFrom) {
      return false;
    }

    if (query.dateTo && record.timestamp > query.dateTo) {
      return false;
    }

    return true;
  });

  const sortBy = query.sortBy ?? "errorScore";
  const sortDirection = query.sortDirection ?? "desc";
  const direction = sortDirection === "desc" ? -1 : 1;

  filtered.sort((left, right) => {
    if (sortBy === "timestamp") {
      return left.timestamp.localeCompare(right.timestamp) * direction;
    }
    if (sortBy === "finalConfidence") {
      return (left.finalConfidence - right.finalConfidence) * direction;
    }
    return (left.errorScore - right.errorScore) * direction;
  });

  return filtered;
}

async function appendMetadataCorrectionAuditLog(entry: {
  actorId: string;
  action: string;
  targetIds: string[];
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  await firestore.collection(METADATA_CORRECTION_AUDIT_COLLECTION).doc(id).set({
    id,
    actorId: entry.actorId,
    action: entry.action,
    targetIds: entry.targetIds,
    before: entry.before,
    after: entry.after,
    timestamp: new Date().toISOString(),
  }, { merge: false });
}

function buildRulesFromCorrections(
  corrections: MetadataCorrectionRecord[],
  priorRules: MetadataCorrectionRulesRecord
): MetadataCorrectionRulesRecord {
  const frequency = new Map<string, { from: string; to: string; count: number; publisherKey: string }>();

  for (const correction of corrections) {
    const publisherKey = normalizePublisherRuleKey(correction.publisher ?? correction.finalMetadata.publisher);
    const sourceCandidates = [
      correction.originalVisionOutput?.title,
      correction.originalVisionOutput?.publisher,
      correction.originalVisionOutput?.series,
      correction.originalVisionOutput?.edition,
    ];
    const targetCandidates = [
      correction.finalMetadata.title,
      correction.finalMetadata.publisher,
      correction.finalMetadata.series,
      correction.finalMetadata.edition,
    ];

    for (let index = 0; index < sourceCandidates.length; index += 1) {
      const from = sourceCandidates[index]?.trim();
      const to = targetCandidates[index]?.trim();
      if (!from || !to || from.toLowerCase() === to.toLowerCase()) {
        continue;
      }

      const key = `${from.toLowerCase()}=>${to.toLowerCase()}|${publisherKey}`;
      const current = frequency.get(key);
      if (current) {
        current.count += 1;
      } else {
        frequency.set(key, { from, to, count: 1, publisherKey });
      }
    }
  }

  const ranked = [...frequency.values()].sort((left, right) => right.count - left.count);
  const globalReplacements = [
    ...priorRules.globalReplacements,
    ...ranked.slice(0, 100).map((item) => ({ from: item.from, to: item.to })),
  ].slice(0, 200);

  const publisherSpecific: MetadataCorrectionRulesRecord["publisherSpecific"] = {
    ...priorRules.publisherSpecific,
  };

  for (const item of ranked.slice(0, 100)) {
    if (!item.publisherKey) {
      continue;
    }

    const prior = publisherSpecific[item.publisherKey] ?? { replacements: [] };
    prior.replacements = [...prior.replacements, { from: item.from, to: item.to }].slice(0, 100);
    publisherSpecific[item.publisherKey] = prior;
  }

  return sanitizeMetadataCorrectionRules({
    version: `rules-${Date.now()}`,
    updatedAt: new Date().toISOString(),
    globalReplacements,
    publisherSpecific,
  });
}

function inferImageMimeType(imageDataUrl: string): string {
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  const mimeType = match?.[1]?.toLowerCase() ?? "";
  if (["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType)) {
    return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  }

  throw new HttpsError("invalid-argument", "Unsupported screenshot format. Use PNG, JPEG, or WEBP.");
}

async function consumeOcrRequestQuota(uid: string): Promise<void> {
  const usageRef = firestore.doc(`users/${uid}/ocrUsage/current`);

  await firestore.runTransaction(async (transaction) => {
    const now = Date.now();
    const snapshot = await transaction.get(usageRef);
    const data = snapshot.exists ? snapshot.data() ?? {} : {};
    const windowStartMs = typeof data.windowStartMs === "number" ? data.windowStartMs : now;
    const usedCount = typeof data.usedCount === "number" ? data.usedCount : 0;
    const withinWindow = now - windowStartMs < OCR_RATE_LIMIT_WINDOW_MS;

    const nextWindowStart = withinWindow ? windowStartMs : now;
    const nextCount = withinWindow ? usedCount + 1 : 1;

    if (withinWindow && usedCount >= OCR_RATE_LIMIT_MAX_REQUESTS) {
      throw new HttpsError("resource-exhausted", "OCR request limit reached. Please wait a minute and try again.");
    }

    transaction.set(usageRef, {
      windowStartMs: nextWindowStart,
      usedCount: nextCount,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  });
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

function getUtcDateKey(now = new Date()): string {
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dateFormatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? String(now.getUTCFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? pad2(now.getUTCMonth() + 1);
  const day = parts.find((part) => part.type === "day")?.value ?? pad2(now.getUTCDate());
  return `${year}-${month}-${day}`;
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

function toQuotaNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }

  return null;
}

function getBestQuotaBucketLimit(limit: Record<string, unknown>): number | null {
  const buckets = Array.isArray(limit.quotaBuckets) ? limit.quotaBuckets : [];
  const fromBuckets = buckets
    .map((bucket) => {
      if (!bucket || typeof bucket !== "object") {
        return null;
      }

      const record = bucket as Record<string, unknown>;
      return toQuotaNumber(record.effectiveLimit) ?? toQuotaNumber(record.defaultLimit);
    })
    .filter((value): value is number => typeof value === "number");

  if (fromBuckets.length > 0) {
    return Math.max(...fromBuckets);
  }

  return toQuotaNumber(limit.effectiveLimit) ?? toQuotaNumber(limit.defaultLimit);
}

async function resolveServiceUsageProjectResource(projectId: string, accessToken: string): Promise<string> {
  if (/^\d+$/.test(projectId)) {
    return `projects/${projectId}`;
  }

  try {
    const response = await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      console.warn(`[super-admin] cloudresourcemanager project lookup returned ${response.status}; using project id for Service Usage.`);
      return `projects/${projectId}`;
    }

    const payload = await response.json() as GoogleCloudProjectMetadata;
    const projectNumber = typeof payload.projectNumber === "number"
      ? String(payload.projectNumber)
      : typeof payload.projectNumber === "string"
        ? payload.projectNumber.trim()
        : "";

    if (projectNumber) {
      return `projects/${projectNumber}`;
    }
  } catch (error) {
    console.warn("[super-admin] cloudresourcemanager project lookup failed; using project id for Service Usage.", error);
  }

  return `projects/${projectId}`;
}

function parseFirestoreQuotaResponse(payload: unknown): {
  readLimitPerDay: number | null;
  writeLimitPerDay: number | null;
  details: SuperAdminGlobalQuotaDetails[];
} {
  const metrics = payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).consumerQuotaMetrics)
    ? (payload as Record<string, unknown>).consumerQuotaMetrics as Array<Record<string, unknown>>
    : [];

  const details: SuperAdminGlobalQuotaDetails[] = [];
  let readLimitPerDay: number | null = null;
  let writeLimitPerDay: number | null = null;

  metrics.forEach((metric) => {
    const metricName = typeof metric.metric === "string" ? metric.metric : "";
    const limitRows = Array.isArray(metric.consumerQuotaLimits)
      ? metric.consumerQuotaLimits as Array<Record<string, unknown>>
      : [];

    limitRows.forEach((limit) => {
      const unit = typeof limit.unit === "string" ? limit.unit : null;
      const displayName = typeof limit.displayName === "string" ? limit.displayName : null;
      const effectiveLimit = getBestQuotaBucketLimit(limit);
      const defaultLimit = toQuotaNumber(limit.defaultLimit);

      details.push({
        metric: metricName,
        displayName,
        unit,
        effectiveLimit,
        defaultLimit,
      });

      const lowerMetric = metricName.toLowerCase();
      const lowerDisplayName = (displayName ?? "").toLowerCase();
      const isDaily = (unit ?? "").toLowerCase().includes("/d") || lowerDisplayName.includes("per day");
      const candidateLimit = effectiveLimit ?? defaultLimit;

      if (!isDaily || candidateLimit === null) {
        return;
      }

      const isRead = lowerMetric.includes("read") || lowerDisplayName.includes("read");
      const isWrite = lowerMetric.includes("write") || lowerDisplayName.includes("write");

      if (isRead) {
        readLimitPerDay = readLimitPerDay === null ? candidateLimit : Math.max(readLimitPerDay, candidateLimit);
      }

      if (isWrite) {
        writeLimitPerDay = writeLimitPerDay === null ? candidateLimit : Math.max(writeLimitPerDay, candidateLimit);
      }
    });
  });

  return { readLimitPerDay, writeLimitPerDay, details };
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

function normalizeAiUsage(record: FirebaseFirestore.DocumentData | undefined | null): AiUsageState {
  const defaults: AiUsageState = {
    aiRequestsToday: 0,
    aiTokensToday: 0,
    aiExecutionsToday: 0,
    aiBucketHitsToday: 0,
    aiFailuresToday: 0,
    screenshotTextRequestsToday: 0,
    imageMetadataRequestsToday: 0,
    documentContentRequestsToday: 0,
    providerRateLimitedToday: 0,
    openAiRequestsToday: 0,
    openAiTokensToday: 0,
    githubRequestsToday: 0,
    githubTokensToday: 0,
    openAiRateLimitedToday: 0,
    githubRateLimitedToday: 0,
    lastResetDate: getUtcDateKey(),
  };

  if (!record || typeof record !== "object") {
    return defaults;
  }

  return {
    aiRequestsToday: typeof record.aiRequestsToday === "number" ? Math.max(0, Math.floor(record.aiRequestsToday)) : defaults.aiRequestsToday,
    aiTokensToday: typeof record.aiTokensToday === "number" ? Math.max(0, Math.floor(record.aiTokensToday)) : defaults.aiTokensToday,
    aiExecutionsToday: typeof record.aiExecutionsToday === "number" ? Math.max(0, Math.floor(record.aiExecutionsToday)) : defaults.aiExecutionsToday,
    aiBucketHitsToday: typeof record.aiBucketHitsToday === "number" ? Math.max(0, Math.floor(record.aiBucketHitsToday)) : defaults.aiBucketHitsToday,
    aiFailuresToday: typeof record.aiFailuresToday === "number" ? Math.max(0, Math.floor(record.aiFailuresToday)) : defaults.aiFailuresToday,
    screenshotTextRequestsToday: typeof record.screenshotTextRequestsToday === "number" ? Math.max(0, Math.floor(record.screenshotTextRequestsToday)) : defaults.screenshotTextRequestsToday,
    imageMetadataRequestsToday: typeof record.imageMetadataRequestsToday === "number" ? Math.max(0, Math.floor(record.imageMetadataRequestsToday)) : defaults.imageMetadataRequestsToday,
    documentContentRequestsToday: typeof record.documentContentRequestsToday === "number" ? Math.max(0, Math.floor(record.documentContentRequestsToday)) : defaults.documentContentRequestsToday,
    providerRateLimitedToday: typeof record.providerRateLimitedToday === "number" ? Math.max(0, Math.floor(record.providerRateLimitedToday)) : defaults.providerRateLimitedToday,
    openAiRequestsToday: typeof record.openAiRequestsToday === "number" ? Math.max(0, Math.floor(record.openAiRequestsToday)) : defaults.openAiRequestsToday,
    openAiTokensToday: typeof record.openAiTokensToday === "number" ? Math.max(0, Math.floor(record.openAiTokensToday)) : defaults.openAiTokensToday,
    githubRequestsToday: typeof record.githubRequestsToday === "number" ? Math.max(0, Math.floor(record.githubRequestsToday)) : defaults.githubRequestsToday,
    githubTokensToday: typeof record.githubTokensToday === "number" ? Math.max(0, Math.floor(record.githubTokensToday)) : defaults.githubTokensToday,
    openAiRateLimitedToday: typeof record.openAiRateLimitedToday === "number" ? Math.max(0, Math.floor(record.openAiRateLimitedToday)) : defaults.openAiRateLimitedToday,
    githubRateLimitedToday: typeof record.githubRateLimitedToday === "number" ? Math.max(0, Math.floor(record.githubRateLimitedToday)) : defaults.githubRateLimitedToday,
    lastResetDate: typeof record.lastResetDate === "string" ? record.lastResetDate : defaults.lastResetDate,
  };
}

function applyAiUsageResets(usage: AiUsageState, now = new Date()): AiUsageState {
  const next = { ...usage };
  const dateKey = getUtcDateKey(now);

  if (next.lastResetDate !== dateKey) {
    next.aiRequestsToday = 0;
    next.aiTokensToday = 0;
    next.aiExecutionsToday = 0;
    next.aiBucketHitsToday = 0;
    next.aiFailuresToday = 0;
    next.screenshotTextRequestsToday = 0;
    next.imageMetadataRequestsToday = 0;
    next.documentContentRequestsToday = 0;
    next.providerRateLimitedToday = 0;
    next.openAiRequestsToday = 0;
    next.openAiTokensToday = 0;
    next.githubRequestsToday = 0;
    next.githubTokensToday = 0;
    next.openAiRateLimitedToday = 0;
    next.githubRateLimitedToday = 0;
    next.lastResetDate = dateKey;
  }

  return next;
}

function sanitizeOpenAiModelKey(model: string): string {
  return model.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 80) || "unknown-model";
}

function parseRateLimitHeaderNumber(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function parseRetryAfterSeconds(headers: Headers): number | null {
  const retryAfter = headers.get("retry-after")?.trim();
  if (!retryAfter) {
    return null;
  }

  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds;
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isNaN(retryAt)) {
    return null;
  }

  const deltaMs = retryAt - Date.now();
  if (deltaMs <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(deltaMs / 1000));
}

function deriveUsedPercent(limit: number | null, remaining: number | null): number | null {
  if (limit === null || remaining === null || limit <= 0) {
    return null;
  }

  const used = Math.max(0, limit - remaining);
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

function extractOpenAiRateLimitSnapshot(model: string, headers: Headers): OpenAiRateLimitSnapshot {
  const defaults = OPENAI_MODEL_LIMIT_DEFAULTS[model] ?? {
    requestsPerMinute: null,
    tokensPerMinute: null,
    requestsPerDay: null,
    tokensPerDay: null,
  };

  const requestsPerMinuteLimit = parseRateLimitHeaderNumber(headers.get("x-ratelimit-limit-requests")) ?? defaults.requestsPerMinute;
  const requestsPerMinuteRemaining = parseRateLimitHeaderNumber(headers.get("x-ratelimit-remaining-requests"));
  const requestsResetIn = headers.get("x-ratelimit-reset-requests")?.trim() || null;
  const tokensPerMinuteLimit = parseRateLimitHeaderNumber(headers.get("x-ratelimit-limit-tokens")) ?? defaults.tokensPerMinute;
  const tokensPerMinuteRemaining = parseRateLimitHeaderNumber(headers.get("x-ratelimit-remaining-tokens"));
  const tokensResetIn = headers.get("x-ratelimit-reset-tokens")?.trim() || null;
  const source: "headers" | "defaults" = (
    headers.has("x-ratelimit-limit-requests")
    || headers.has("x-ratelimit-limit-tokens")
    || headers.has("x-ratelimit-remaining-requests")
    || headers.has("x-ratelimit-remaining-tokens")
  ) ? "headers" : "defaults";

  return {
    model,
    capturedAt: new Date().toISOString(),
    source,
    requestsPerMinuteLimit,
    requestsPerMinuteRemaining,
    requestsResetIn,
    tokensPerMinuteLimit,
    tokensPerMinuteRemaining,
    tokensResetIn,
    requestsPerDayLimit: defaults.requestsPerDay,
    tokensPerDayLimit: defaults.tokensPerDay,
    requestWindowUsedPercent: deriveUsedPercent(requestsPerMinuteLimit, requestsPerMinuteRemaining),
    tokenWindowUsedPercent: deriveUsedPercent(tokensPerMinuteLimit, tokensPerMinuteRemaining),
  };
}

async function recordOpenAiRateLimitSnapshotBestEffort(model: string, headers: Headers): Promise<void> {
  try {
    const snapshot = extractOpenAiRateLimitSnapshot(model, headers);
    const docRef = firestore.doc(`${OPENAI_RATE_LIMIT_DOC_ROOT}/${sanitizeOpenAiModelKey(model)}`);
    await docRef.set(snapshot, { merge: true });
  } catch (error) {
    console.warn("[AI limits] Failed to persist OpenAI rate-limit snapshot", {
      model,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function recordGitHubRateLimitStatusBestEffort(input: {
  isRateLimited: boolean;
  retryAfterSeconds: number | null;
  source: string;
}): Promise<void> {
  try {
    const observedAt = new Date().toISOString();
    const retryAfterSeconds = typeof input.retryAfterSeconds === "number" && input.retryAfterSeconds > 0
      ? Math.max(1, Math.floor(input.retryAfterSeconds))
      : null;
    const retryAfterUntil = retryAfterSeconds !== null
      ? new Date(Date.now() + (retryAfterSeconds * 1000)).toISOString()
      : null;

    await firestore.doc(AI_PROVIDER_STATUS_DOC_PATH).set({
      githubRateLimit: {
        isRateLimited: input.isRateLimited,
        retryAfterSeconds,
        retryAfterUntil,
        observedAt,
        source: input.source,
      },
    }, { merge: true });
  } catch (error) {
    console.warn("[AI limits] Failed to persist GitHub rate-limit status", {
      error: error instanceof Error ? error.message : String(error),
      input,
    });
  }
}

async function getGitHubRateLimitStatus(): Promise<{ isRateLimited: boolean; retryAfterSeconds: number | null; retryAfterUntil: string | null; observedAt: string | null; }> {
  try {
    const snapshot = await firestore.doc(AI_PROVIDER_STATUS_DOC_PATH).get();
    const raw = snapshot.data()?.githubRateLimit as Record<string, unknown> | undefined;

    const retryAfterSeconds = typeof raw?.retryAfterSeconds === "number" && Number.isFinite(raw.retryAfterSeconds)
      ? Math.max(1, Math.floor(raw.retryAfterSeconds))
      : null;
    const retryAfterUntil = typeof raw?.retryAfterUntil === "string" ? raw.retryAfterUntil : null;
    const observedAt = typeof raw?.observedAt === "string" ? raw.observedAt : null;

    let isRateLimited = raw?.isRateLimited === true;
    if (isRateLimited && retryAfterUntil) {
      const until = Date.parse(retryAfterUntil);
      if (!Number.isNaN(until) && until <= Date.now()) {
        isRateLimited = false;
      }
    }

    return {
      isRateLimited,
      retryAfterSeconds,
      retryAfterUntil,
      observedAt,
    };
  } catch (error) {
    console.warn("[AI limits] Failed to load GitHub rate-limit status", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      isRateLimited: false,
      retryAfterSeconds: null,
      retryAfterUntil: null,
      observedAt: null,
    };
  }
}

function normalizeGitHubCopilotTier(value: unknown): GitHubCopilotTier {
  if (value === "free" || value === "pro" || value === "business" || value === "enterprise") {
    return value;
  }

  return DEFAULT_GITHUB_COPILOT_TIER;
}

function normalizeAiSafetyPolicy(value: unknown): AiSafetyPolicyRecord {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

  const defaultDailyRequestLimit = typeof data.defaultDailyRequestLimit === "number"
    ? Math.max(1, Math.round(data.defaultDailyRequestLimit))
    : DEFAULT_USER_AI_DAILY_REQUEST_LIMIT;
  const defaultDailyTokenLimit = typeof data.defaultDailyTokenLimit === "number"
    ? Math.max(1000, Math.round(data.defaultDailyTokenLimit))
    : DEFAULT_USER_AI_DAILY_TOKEN_LIMIT;
  const defaultMonthlyBudgetUsd = typeof data.defaultMonthlyBudgetUsd === "number"
    ? Math.max(0, Number(data.defaultMonthlyBudgetUsd.toFixed(2)))
    : DEFAULT_OPENAI_MONTHLY_BUDGET_USD;
  const openAiMonthlySpendUsd = typeof data.openAiMonthlySpendUsd === "number"
    ? Math.max(0, Number(data.openAiMonthlySpendUsd.toFixed(2)))
    : null;

  const githubCopilotTier = normalizeGitHubCopilotTier(data.githubCopilotTier);
  const githubTierDefaults = GITHUB_COPILOT_TIER_LIMITS[githubCopilotTier];
  const githubDailyRequestLimit = typeof data.githubDailyRequestLimit === "number"
    ? Math.max(1, Math.round(data.githubDailyRequestLimit))
    : githubTierDefaults.requestsPerDayLimit;
  const githubDailyTokenLimit = typeof data.githubDailyTokenLimit === "number"
    ? Math.max(1000, Math.round(data.githubDailyTokenLimit))
    : Math.max(1000, githubDailyRequestLimit * (githubTierDefaults.tokensPerRequestInputLimit + githubTierDefaults.tokensPerRequestOutputLimit));
  const githubRequestsPerMinuteLimit = typeof data.githubRequestsPerMinuteLimit === "number"
    ? Math.max(1, Math.round(data.githubRequestsPerMinuteLimit))
    : githubTierDefaults.requestsPerMinuteLimit;
  const githubTokensPerRequestInputLimit = typeof data.githubTokensPerRequestInputLimit === "number"
    ? Math.max(1000, Math.round(data.githubTokensPerRequestInputLimit))
    : githubTierDefaults.tokensPerRequestInputLimit;
  const githubTokensPerRequestOutputLimit = typeof data.githubTokensPerRequestOutputLimit === "number"
    ? Math.max(1000, Math.round(data.githubTokensPerRequestOutputLimit))
    : githubTierDefaults.tokensPerRequestOutputLimit;
  const githubConcurrentRequestsLimit = typeof data.githubConcurrentRequestsLimit === "number"
    ? Math.max(1, Math.round(data.githubConcurrentRequestsLimit))
    : githubTierDefaults.concurrentRequestsLimit;

  const budgetAlertThresholdPct = typeof data.budgetAlertThresholdPct === "number"
    ? Math.min(100, Math.max(1, Number(data.budgetAlertThresholdPct.toFixed(1))))
    : DEFAULT_OPENAI_BUDGET_ALERT_THRESHOLD_PCT;
  const budgetHardStopThresholdPct = typeof data.budgetHardStopThresholdPct === "number"
    ? Math.min(100, Math.max(budgetAlertThresholdPct, Number(data.budgetHardStopThresholdPct.toFixed(1))))
    : DEFAULT_OPENAI_BUDGET_HARD_STOP_PCT;

  return {
    defaultDailyRequestLimit,
    defaultDailyTokenLimit,
    defaultMonthlyBudgetUsd,
    openAiMonthlySpendUsd,
    githubCopilotTier,
    githubDailyRequestLimit,
    githubDailyTokenLimit,
    githubRequestsPerMinuteLimit,
    githubTokensPerRequestInputLimit,
    githubTokensPerRequestOutputLimit,
    githubConcurrentRequestsLimit,
    budgetAlertThresholdPct,
    budgetHardStopThresholdPct,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "system",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date(0).toISOString(),
  };
}

async function getAiSafetyPolicyRecord(): Promise<AiSafetyPolicyRecord> {
  const snapshot = await firestore.doc(AI_SAFETY_POLICY_DOC_PATH).get();
  const policy = normalizeAiSafetyPolicy(snapshot.data());

  if (!snapshot.exists) {
    await firestore.doc(AI_SAFETY_POLICY_DOC_PATH).set(policy, { merge: true });
  }

  return policy;
}

function normalizeAiSafetyOverride(value: unknown): AiSafetyOverrideRecord {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    dailyRequestLimit: typeof data.dailyRequestLimit === "number" ? Math.max(1, Math.round(data.dailyRequestLimit)) : null,
    dailyTokenLimit: typeof data.dailyTokenLimit === "number" ? Math.max(1000, Math.round(data.dailyTokenLimit)) : null,
    monthlyBudgetUsd: typeof data.monthlyBudgetUsd === "number" ? Math.max(0, Number(data.monthlyBudgetUsd.toFixed(2))) : null,
    githubDailyRequestLimit: typeof data.githubDailyRequestLimit === "number" ? Math.max(1, Math.round(data.githubDailyRequestLimit)) : null,
    githubDailyTokenLimit: typeof data.githubDailyTokenLimit === "number" ? Math.max(1000, Math.round(data.githubDailyTokenLimit)) : null,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "system",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date(0).toISOString(),
  };
}

async function getAiSafetyOverrideForUser(uid: string): Promise<AiSafetyOverrideRecord | null> {
  const snapshot = await firestore.doc(`users/${uid}/aiSafety/current`).get();
  if (!snapshot.exists) {
    return null;
  }

  return normalizeAiSafetyOverride(snapshot.data());
}

function buildCurrentAiSafetyStatusResult(usage: AiUsageState, policy: AiSafetyPolicyRecord, override: AiSafetyOverrideRecord | null): CurrentAiSafetyStatusResult {
  const effectiveDailyRequestLimit = override?.dailyRequestLimit ?? policy.defaultDailyRequestLimit;
  const effectiveDailyTokenLimit = override?.dailyTokenLimit ?? policy.defaultDailyTokenLimit;
  const effectiveMonthlyBudgetUsd = override?.monthlyBudgetUsd ?? policy.defaultMonthlyBudgetUsd;
  const effectiveGithubDailyRequestLimit = override?.githubDailyRequestLimit ?? policy.githubDailyRequestLimit;
  const effectiveGithubDailyTokenLimit = override?.githubDailyTokenLimit ?? policy.githubDailyTokenLimit;
  const monthlyBudgetUsagePercent = policy.openAiMonthlySpendUsd !== null && effectiveMonthlyBudgetUsd > 0
    ? Math.max(0, (policy.openAiMonthlySpendUsd / effectiveMonthlyBudgetUsd) * 100)
    : null;

  const dailyRequestUsagePercent = Math.max(0, Math.min(1000, (usage.aiRequestsToday / Math.max(1, effectiveDailyRequestLimit)) * 100));
  const dailyTokenUsagePercent = Math.max(0, Math.min(1000, (usage.aiTokensToday / Math.max(1, effectiveDailyTokenLimit)) * 100));
  const githubDailyRequestUsagePercent = Math.max(0, Math.min(1000, (usage.githubRequestsToday / Math.max(1, effectiveGithubDailyRequestLimit)) * 100));
  const githubDailyTokenUsagePercent = Math.max(0, Math.min(1000, (usage.githubTokensToday / Math.max(1, effectiveGithubDailyTokenLimit)) * 100));

  return {
    usage,
    effectiveLimits: {
      dailyRequestLimit: effectiveDailyRequestLimit,
      dailyTokenLimit: effectiveDailyTokenLimit,
      monthlyBudgetUsd: effectiveMonthlyBudgetUsd,
      githubDailyRequestLimit: effectiveGithubDailyRequestLimit,
      githubDailyTokenLimit: effectiveGithubDailyTokenLimit,
      githubCopilotTier: policy.githubCopilotTier,
      githubRequestsPerMinuteLimit: policy.githubRequestsPerMinuteLimit,
      githubTokensPerRequestInputLimit: policy.githubTokensPerRequestInputLimit,
      githubTokensPerRequestOutputLimit: policy.githubTokensPerRequestOutputLimit,
      githubConcurrentRequestsLimit: policy.githubConcurrentRequestsLimit,
      budgetAlertThresholdPct: policy.budgetAlertThresholdPct,
      budgetHardStopThresholdPct: policy.budgetHardStopThresholdPct,
      openAiMonthlySpendUsd: policy.openAiMonthlySpendUsd,
    },
    dailyRequestUsagePercent,
    dailyTokenUsagePercent,
    githubDailyRequestUsagePercent,
    githubDailyTokenUsagePercent,
    monthlyBudgetUsagePercent,
    hasExceededDailyRequestLimit: usage.aiRequestsToday >= effectiveDailyRequestLimit,
    hasExceededDailyTokenLimit: usage.aiTokensToday >= effectiveDailyTokenLimit,
    hasExceededGithubDailyRequestLimit: usage.githubRequestsToday >= effectiveGithubDailyRequestLimit,
    hasExceededGithubDailyTokenLimit: usage.githubTokensToday >= effectiveGithubDailyTokenLimit,
    hasExceededMonthlyBudgetThreshold: monthlyBudgetUsagePercent !== null && monthlyBudgetUsagePercent >= policy.budgetHardStopThresholdPct,
  };
}

async function listOpenAiRateLimitSnapshots(): Promise<OpenAiRateLimitSnapshot[]> {
  const snapshots = await firestore.collection("providerRateLimits").doc("openai").collection("models").get();
  return snapshots.docs
    .map((docSnap) => {
      const raw = docSnap.data() as Partial<OpenAiRateLimitSnapshot>;
      const model = typeof raw.model === "string" ? raw.model : docSnap.id;
      const headers = new Headers();

      if (typeof raw.requestsPerMinuteLimit === "number") {
        headers.set("x-ratelimit-limit-requests", String(raw.requestsPerMinuteLimit));
      }
      if (typeof raw.requestsPerMinuteRemaining === "number") {
        headers.set("x-ratelimit-remaining-requests", String(raw.requestsPerMinuteRemaining));
      }
      if (typeof raw.requestsResetIn === "string") {
        headers.set("x-ratelimit-reset-requests", raw.requestsResetIn);
      }
      if (typeof raw.tokensPerMinuteLimit === "number") {
        headers.set("x-ratelimit-limit-tokens", String(raw.tokensPerMinuteLimit));
      }
      if (typeof raw.tokensPerMinuteRemaining === "number") {
        headers.set("x-ratelimit-remaining-tokens", String(raw.tokensPerMinuteRemaining));
      }
      if (typeof raw.tokensResetIn === "string") {
        headers.set("x-ratelimit-reset-tokens", raw.tokensResetIn);
      }

      const normalized = extractOpenAiRateLimitSnapshot(model, headers);
      return {
        ...normalized,
        source: raw.source === "headers" || raw.source === "defaults" ? raw.source : normalized.source,
        capturedAt: typeof raw.capturedAt === "string" ? raw.capturedAt : normalized.capturedAt,
      };
    })
    .sort((left, right) => left.model.localeCompare(right.model));
}

async function getAiUsageDocRef(uid: string): Promise<FirebaseFirestore.DocumentReference> {
  return firestore.doc(`users/${uid}/aiUsage/current`);
}

async function recordAiUsage(uid: string, increment: AiUsageIncrement): Promise<void> {
  const docRef = await getAiUsageDocRef(uid);

  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const normalized = applyAiUsageResets(normalizeAiUsage(snapshot.exists ? snapshot.data() : null));

    const requestCount = increment.requestCount ?? 0;
    const tokenCount = increment.tokenCount ?? 0;
    const executionCount = increment.executionCount ?? 0;
    const bucketHitCount = increment.bucketHitCount ?? 0;
    const failureCount = increment.failureCount ?? 0;
    const rateLimitedCount = increment.rateLimitedCount ?? 0;

    const provider = increment.provider;
    const next: AiUsageState = {
      ...normalized,
      aiRequestsToday: normalized.aiRequestsToday + requestCount,
      aiTokensToday: normalized.aiTokensToday + tokenCount,
      aiExecutionsToday: normalized.aiExecutionsToday + executionCount,
      aiBucketHitsToday: normalized.aiBucketHitsToday + bucketHitCount,
      aiFailuresToday: normalized.aiFailuresToday + failureCount,
      screenshotTextRequestsToday: normalized.screenshotTextRequestsToday + (increment.kind === "screenshot_text" ? requestCount : 0),
      imageMetadataRequestsToday: normalized.imageMetadataRequestsToday + (increment.kind === "image_metadata" ? requestCount : 0),
      documentContentRequestsToday: normalized.documentContentRequestsToday + (increment.kind === "document_content" ? requestCount : 0),
      providerRateLimitedToday: normalized.providerRateLimitedToday + rateLimitedCount,
      openAiRequestsToday: normalized.openAiRequestsToday + (provider === "openai" ? requestCount : 0),
      openAiTokensToday: normalized.openAiTokensToday + (provider === "openai" ? tokenCount : 0),
      githubRequestsToday: normalized.githubRequestsToday + (provider === "github" ? requestCount : 0),
      githubTokensToday: normalized.githubTokensToday + (provider === "github" ? tokenCount : 0),
      openAiRateLimitedToday: normalized.openAiRateLimitedToday + (provider === "openai" ? rateLimitedCount : 0),
      githubRateLimitedToday: normalized.githubRateLimitedToday + (provider === "github" ? rateLimitedCount : 0),
    };

    transaction.set(docRef, next, { merge: true });
  });
}

const inFlightAiRequests = new Map<string, Promise<unknown>>();

function getOrStartAiRequest<T>(requestKey: string, executor: () => Promise<T>): { promise: Promise<T>; isPrimary: boolean } {
  const existing = inFlightAiRequests.get(requestKey) as Promise<T> | undefined;
  if (existing) {
    return { promise: existing, isPrimary: false };
  }

  const promise = executor().finally(() => {
    if (inFlightAiRequests.get(requestKey) === promise) {
      inFlightAiRequests.delete(requestKey);
    }
  });

  inFlightAiRequests.set(requestKey, promise);
  return { promise, isPrimary: true };
}

function buildAiRequestKey(kind: AiUsageKind, uid: string, payload: string): string {
  return `${kind}:${uid}:${createHash("sha256").update(payload).digest("hex")}`;
}

function toHttpsErrorCode(error: unknown): string | null {
  if (error instanceof HttpsError) {
    return error.code;
  }

  return null;
}

async function recordAiUsageBestEffort(uid: string, increment: AiUsageIncrement): Promise<void> {
  try {
    await recordAiUsage(uid, increment);
  } catch (error) {
    console.warn("[AI usage] Failed to record usage", {
      uid,
      increment,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function recordAiProviderFailure(increment: AiUsageIncrement, error: unknown): AiUsageIncrement {
  const code = toHttpsErrorCode(error);
  return {
    ...increment,
    failureCount: (increment.failureCount ?? 0) + 1,
    rateLimitedCount: (increment.rateLimitedCount ?? 0) + (code === "resource-exhausted" ? 1 : 0),
  };
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

async function touchOwnerSyncTokenFromDocPath(docPath: string): Promise<void> {
  const snapshot = await firestore.doc(docPath).get();
  if (!snapshot.exists) {
    return;
  }

  const data = snapshot.data() ?? {};
  const ownerId = typeof data.ownerId === "string"
    ? data.ownerId.trim()
    : typeof data.userId === "string"
      ? data.userId.trim()
      : "";

  if (!ownerId) {
    return;
  }

  await firestore.doc(`users/${ownerId}`).set(
    {
      uid: ownerId,
      syncToken: new Date().toISOString(),
    },
    { merge: true }
  );
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
    isSchoolAdmin: data.isSchoolAdmin === true,
    isSuperAdmin: data.isSuperAdmin === true,
    schoolId: typeof data.schoolId === "string" ? data.schoolId : null,
    schoolName: typeof data.schoolName === "string" ? data.schoolName : null,
    districtName: typeof data.districtName === "string" ? data.districtName : null,
    isContentBlocked: data.isContentBlocked === true,
    contentBlockReason: typeof data.contentBlockReason === "string" ? data.contentBlockReason : null,
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

export const setUserContentBlockStatus = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const uid = typeof data?.uid === "string" ? data.uid.trim() : "";
  const isContentBlocked = data?.isContentBlocked === true;
  const contentBlockReason = typeof data?.contentBlockReason === "string"
    ? data.contentBlockReason.trim()
    : "";

  if (!uid) {
    throw new HttpsError("invalid-argument", "A user id is required.");
  }

  const userRecord = await auth.getUser(uid);
  const targetIsSuperAdmin = userRecord.customClaims?.superAdmin === true;

  if (targetIsSuperAdmin) {
    await firestore.doc(`users/${uid}`).set(
      {
        uid,
        isContentBlocked: false,
        contentBlockReason: null,
        lastContentBlockUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const message = "Super admin accounts cannot be blocked from cloud sync.";
    return success(message, message);
  }

  await firestore.doc(`users/${uid}`).set(
    {
      uid,
      isContentBlocked,
      contentBlockReason: isContentBlocked ? (contentBlockReason || "Blocked by admin moderation decision.") : null,
      lastContentBlockUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const message = isContentBlocked
    ? `Blocked cloud sync for user ${uid}.`
    : `Unblocked cloud sync for user ${uid}.`;

  return success(message, message);
});

export const listAdminUsers = onCall(async (request) => {
  assertAdmin(request.auth);

  const snapshot = await firestore.collection("users").orderBy("email").get();
  const users = snapshot.docs.map(toAdminUserRecord);

  const superAdminByUid = new Map<string, boolean>();
  let nextPageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    page.users.forEach((user) => {
      if (user.customClaims?.superAdmin === true) {
        superAdminByUid.set(user.uid, true);
      }
    });
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  const merged = users.map((user) => ({
    ...user,
    isSuperAdmin: user.isSuperAdmin === true || superAdminByUid.get(user.uid) === true,
  }));

  return success("Loaded users.", merged);
});

export const listSchoolDirectory = onCall(async (request) => {
  assertSignedIn(request.auth);

  const query = typeof request.data?.query === "string" ? request.data.query.trim().toLowerCase() : "";
  const snapshot = await firestore.collection("schools").orderBy("schoolName").limit(120).get();
  const rows = snapshot.docs
    .map((docSnap): SchoolDirectoryRow => {
      const data = docSnap.data();
      return {
        schoolId: docSnap.id,
        schoolName: typeof data.schoolName === "string" ? data.schoolName : docSnap.id,
        districtName: typeof data.districtName === "string" ? data.districtName : null,
        memberCount: typeof data.memberCount === "number" ? data.memberCount : 0,
      };
    })
    .filter((row) => !query || row.schoolName.toLowerCase().includes(query) || (row.districtName ?? "").toLowerCase().includes(query))
    .sort((left, right) => left.schoolName.localeCompare(right.schoolName))
    .slice(0, 30);

  return success("Loaded school directory.", rows);
});

export const setUserSchoolAffiliation = onCall(async (request) => {
  assertSignedIn(request.auth);

  const uid = request.auth.uid;
  const schoolName = typeof request.data?.schoolName === "string" ? request.data.schoolName.trim() : "";
  const districtName = typeof request.data?.districtName === "string" ? request.data.districtName.trim() : "";
  const requestedSchoolId = typeof request.data?.schoolId === "string" ? request.data.schoolId.trim() : "";

  if (!schoolName) {
    throw new HttpsError("invalid-argument", "School name is required.");
  }

  const schoolId = normalizeSchoolId(requestedSchoolId || schoolName);
  if (!schoolId) {
    throw new HttpsError("invalid-argument", "Unable to normalize school id from school name.");
  }

  const schoolRef = firestore.doc(`schools/${schoolId}`);
  const usersRef = firestore.collection("users");
  const currentSchoolAdmins = await usersRef.where("schoolId", "==", schoolId).where("isSchoolAdmin", "==", true).limit(1).get();
  const shouldAssignSchoolAdmin = currentSchoolAdmins.empty;

  await schoolRef.set(
    {
      schoolId,
      schoolName,
      districtName: districtName || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const userRef = firestore.doc(`users/${uid}`);
  await userRef.set(
    {
      uid,
      schoolId,
      schoolName,
      districtName: districtName || null,
      isSchoolAdmin: shouldAssignSchoolAdmin,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const userRecord = await auth.getUser(uid);
  const claims = { ...(userRecord.customClaims ?? {}) } as Record<string, unknown>;
  claims.schoolId = schoolId;
  if (shouldAssignSchoolAdmin) {
    claims.schoolAdmin = true;
  }
  await auth.setCustomUserClaims(uid, claims);

  const membersSnapshot = await usersRef.where("schoolId", "==", schoolId).get();
  await schoolRef.set(
    {
      memberCount: membersSnapshot.size,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return success("School affiliation saved.", {
    schoolId,
    schoolName,
    districtName: districtName || null,
    assignedSchoolAdmin: shouldAssignSchoolAdmin,
  });
});

function resolveSchoolIdForRequest(authData: { uid?: string; token?: Record<string, unknown> } | null | undefined, requestedSchoolId: unknown): string {
  const schoolIdFromInput = typeof requestedSchoolId === "string" ? requestedSchoolId.trim() : "";
  const schoolIdFromClaim = typeof authData?.token?.schoolId === "string" ? String(authData.token.schoolId).trim() : "";
  const schoolId = schoolIdFromInput || schoolIdFromClaim;
  if (!schoolId) {
    throw new HttpsError("failed-precondition", "No school is associated with this account yet.");
  }
  return schoolId;
}

async function ensureSchoolAccess(authData: { uid?: string; token?: Record<string, unknown> } | null | undefined, schoolId: string): Promise<void> {
  assertSignedIn(authData);
  if (isSuperAdminToken(authData) || authData.token?.schoolAdmin === true) {
    return;
  }

  const userSnapshot = await firestore.doc(`users/${authData.uid}`).get();
  const userSchoolId = typeof userSnapshot.data()?.schoolId === "string" ? userSnapshot.data()?.schoolId : "";
  if (!userSchoolId || userSchoolId !== schoolId) {
    throw new HttpsError("permission-denied", "You are not authorized for this school.");
  }
}

export const getSchoolAdminDashboard = onCall(async (request) => {
  assertSchoolAdmin(request.auth);
  assertSignedIn(request.auth);
  const schoolId = resolveSchoolIdForRequest(request.auth, request.data?.schoolId);
  await ensureSchoolAccess(request.auth, schoolId);

  const usersSnapshot = await firestore.collection("users").where("schoolId", "==", schoolId).get();
  const ownerEmailMap = new Map<string, string>();
  const users: SchoolUserRow[] = usersSnapshot.docs.map((docSnap) => {
    const row = toAdminUserRecord(docSnap);
    ownerEmailMap.set(row.uid, row.email || "");
    return {
      uid: row.uid,
      email: row.email,
      displayName: row.displayName,
      isAdmin: row.isAdmin,
      isSchoolAdmin: row.isSchoolAdmin === true,
      schoolId: row.schoolId ?? null,
      schoolName: row.schoolName ?? null,
      districtName: row.districtName ?? null,
      lastLoginAt: row.lastLoginAt ?? null,
    };
  });
  const ownerIds = new Set(users.map((row) => row.uid));

  const textbookSnapshot = await firestore.collectionGroup("textbooks").limit(800).get();
  const textbooks: SchoolTextbookRow[] = textbookSnapshot.docs
    .reduce<SchoolTextbookRow[]>((rows, docSnap) => {
      const data = docSnap.data();
      const ownerId = typeof data.ownerId === "string" ? data.ownerId : typeof data.userId === "string" ? data.userId : "";
      if (!ownerId || !ownerIds.has(ownerId)) {
        return rows;
      }

      rows.push({
        id: docSnap.id,
        docPath: docSnap.ref.path,
        ownerId,
        ownerEmail: ownerEmailMap.get(ownerId) ?? null,
        title: typeof data.title === "string" ? data.title : docSnap.id,
        subject: typeof data.subject === "string" ? data.subject : undefined,
        grade: typeof data.grade === "string" ? data.grade : undefined,
        isDeleted: data.isDeleted === true,
        recycleBinDeletedAt: toIsoString(data.recycleBinDeletedAt),
        recycleBinExpiresAt: toIsoString(data.recycleBinExpiresAt),
        lastModified: toIsoString(data.lastModified),
      } satisfies SchoolTextbookRow);
      return rows;
    }, [])
    .sort((left, right) => (right.lastModified ?? "").localeCompare(left.lastModified ?? ""));

  const invitesSnapshot = await firestore.collection("schoolInvites").where("schoolId", "==", schoolId).orderBy("createdAt", "desc").limit(200).get();
  const invites: SchoolInviteRow[] = invitesSnapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      email: typeof data.email === "string" ? data.email : "",
      schoolId,
      schoolName: typeof data.schoolName === "string" ? data.schoolName : users[0]?.schoolName ?? schoolId,
      districtName: typeof data.districtName === "string" ? data.districtName : null,
      invitedByUid: typeof data.invitedByUid === "string" ? data.invitedByUid : "",
      invitedByEmail: typeof data.invitedByEmail === "string" ? data.invitedByEmail : null,
      createdAt: toIsoString(data.createdAt),
      status: data.status === "accepted" || data.status === "revoked" ? data.status : "pending",
    };
  });

  const schoolSnapshot = await firestore.doc(`schools/${schoolId}`).get();
  const schoolData = schoolSnapshot.data() ?? {};
  const result: SchoolDashboardResult = {
    schoolId,
    schoolName: typeof schoolData.schoolName === "string" ? schoolData.schoolName : users[0]?.schoolName ?? schoolId,
    districtName: typeof schoolData.districtName === "string" ? schoolData.districtName : users[0]?.districtName ?? null,
    users,
    textbooks,
    invites,
  };

  return success("Loaded school admin dashboard.", result);
});

export const inviteSchoolUser = onCall(async (request) => {
  assertSchoolAdmin(request.auth);
  assertSignedIn(request.auth);
  const schoolId = resolveSchoolIdForRequest(request.auth, request.data?.schoolId);
  await ensureSchoolAccess(request.auth, schoolId);

  const email = typeof request.data?.email === "string" ? request.data.email.trim().toLowerCase() : "";
  if (!email) {
    throw new HttpsError("invalid-argument", "Invite email is required.");
  }

  const schoolSnapshot = await firestore.doc(`schools/${schoolId}`).get();
  const schoolData = schoolSnapshot.data() ?? {};
  const inviteRef = firestore.collection("schoolInvites").doc();
  const row: SchoolInviteRow = {
    id: inviteRef.id,
    email,
    schoolId,
    schoolName: typeof schoolData.schoolName === "string" ? schoolData.schoolName : schoolId,
    districtName: typeof schoolData.districtName === "string" ? schoolData.districtName : null,
    invitedByUid: request.auth.uid,
    invitedByEmail: typeof request.auth.token?.email === "string" ? String(request.auth.token.email) : null,
    createdAt: new Date().toISOString(),
    status: "pending",
  };

  await inviteRef.set({
    ...row,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return success("Invite created.", row);
});

export const removeSchoolUser = onCall(async (request) => {
  assertSchoolAdmin(request.auth);
  assertSignedIn(request.auth);
  const schoolId = resolveSchoolIdForRequest(request.auth, request.data?.schoolId);
  await ensureSchoolAccess(request.auth, schoolId);

  const uid = typeof request.data?.uid === "string" ? request.data.uid.trim() : "";
  if (!uid) {
    throw new HttpsError("invalid-argument", "User id is required.");
  }

  const targetRef = firestore.doc(`users/${uid}`);
  const targetSnapshot = await targetRef.get();
  if (!targetSnapshot.exists) {
    throw new HttpsError("not-found", "User not found.");
  }

  const targetSchoolId = typeof targetSnapshot.data()?.schoolId === "string" ? targetSnapshot.data()?.schoolId : "";
  if (targetSchoolId !== schoolId && !isSuperAdminToken(request.auth)) {
    throw new HttpsError("permission-denied", "User is not a member of your school.");
  }

  await targetRef.set({
    schoolId: admin.firestore.FieldValue.delete(),
    schoolName: admin.firestore.FieldValue.delete(),
    districtName: admin.firestore.FieldValue.delete(),
    isSchoolAdmin: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  const userRecord = await auth.getUser(uid);
  const claims = { ...(userRecord.customClaims ?? {}) } as Record<string, unknown>;
  delete claims.schoolId;
  delete claims.schoolAdmin;
  await auth.setCustomUserClaims(uid, claims);

  const remainingMembers = await firestore.collection("users").where("schoolId", "==", schoolId).get();
  await firestore.doc(`schools/${schoolId}`).set({
    memberCount: remainingMembers.size,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return success("User removed from school.", "User removed from school.");
});

export const setSchoolTextbookDeletionState = onCall(async (request) => {
  assertSchoolAdmin(request.auth);
  assertSignedIn(request.auth);
  const schoolId = resolveSchoolIdForRequest(request.auth, request.data?.schoolId);
  await ensureSchoolAccess(request.auth, schoolId);

  const textbookId = typeof request.data?.textbookId === "string" ? request.data.textbookId.trim() : "";
  const isDeleted = request.data?.isDeleted === true;

  if (!textbookId) {
    throw new HttpsError("invalid-argument", "Textbook id is required.");
  }

  const textbookRef = firestore.doc(`textbooks/${textbookId}`);
  const textbookSnapshot = await textbookRef.get();
  if (!textbookSnapshot.exists) {
    throw new HttpsError("not-found", "Textbook not found.");
  }

  const textbookData = textbookSnapshot.data() ?? {};
  const ownerId = typeof textbookData.ownerId === "string" ? textbookData.ownerId : typeof textbookData.userId === "string" ? textbookData.userId : "";
  if (!ownerId) {
    throw new HttpsError("failed-precondition", "Textbook owner metadata is missing.");
  }

  const ownerSnapshot = await firestore.doc(`users/${ownerId}`).get();
  const ownerSchoolId = typeof ownerSnapshot.data()?.schoolId === "string" ? ownerSnapshot.data()?.schoolId : "";
  if (ownerSchoolId !== schoolId && !isSuperAdminToken(request.auth)) {
    throw new HttpsError("permission-denied", "This textbook does not belong to your school.");
  }

  const now = new Date();
  const expireAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await textbookRef.set({
    isDeleted,
    recycleBinDeletedAt: isDeleted ? now.toISOString() : null,
    recycleBinExpiresAt: isDeleted ? expireAt.toISOString() : null,
    pendingSync: false,
    lastModified: now.toISOString(),
  }, { merge: true });

  await touchOwnerSyncTokenFromDocPath(`textbooks/${textbookId}`);

  return success(isDeleted ? "Textbook moved to recycle bin." : "Textbook restored.", isDeleted ? "Textbook moved to recycle bin." : "Textbook restored.");
});

export const requestSchoolAdminPromotion = onCall(async (request) => {
  assertSignedIn(request.auth);

  const uid = request.auth.uid;
  const userSnapshot = await firestore.doc(`users/${uid}`).get();
  if (!userSnapshot.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const userData = userSnapshot.data() ?? {};
  const schoolId = typeof userData.schoolId === "string" ? userData.schoolId : "";
  if (!schoolId) {
    throw new HttpsError("failed-precondition", "Set your school affiliation before requesting promotion.");
  }

  const reason = typeof request.data?.reason === "string" ? request.data.reason.trim() : "";
  const existingPending = await firestore.collection("schoolAdminPromotionRequests")
    .where("uid", "==", uid)
    .where("schoolId", "==", schoolId)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!existingPending.empty) {
    return success("A promotion request is already pending.", "A promotion request is already pending.");
  }

  const requestRef = firestore.collection("schoolAdminPromotionRequests").doc();
  await requestRef.set({
    uid,
    email: typeof userData.email === "string" ? userData.email : "",
    displayName: typeof userData.displayName === "string" ? userData.displayName : "",
    schoolId,
    schoolName: typeof userData.schoolName === "string" ? userData.schoolName : schoolId,
    districtName: typeof userData.districtName === "string" ? userData.districtName : null,
    reason: reason || null,
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return success("Promotion request submitted.", "Promotion request submitted.");
});

export const listSchoolAdminPromotionRequests = onCall(async (request) => {
  assertSuperAdmin(request.auth);

  const status = typeof request.data?.status === "string" ? request.data.status : "pending";
  // Avoid composite-index requirements (status + createdAt) by sorting in memory.
  const snapshot = await firestore.collection("schoolAdminPromotionRequests").limit(600).get();
  const rows: PromotionRequestRow[] = snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      uid: typeof data.uid === "string" ? data.uid : "",
      email: typeof data.email === "string" ? data.email : "",
      displayName: typeof data.displayName === "string" ? data.displayName : "",
      schoolId: typeof data.schoolId === "string" ? data.schoolId : "",
      schoolName: typeof data.schoolName === "string" ? data.schoolName : "",
      districtName: typeof data.districtName === "string" ? data.districtName : null,
      reason: typeof data.reason === "string" ? data.reason : null,
      status: data.status === "approved" || data.status === "rejected" ? data.status : "pending",
      createdAt: toIsoString(data.createdAt),
      reviewedAt: toIsoString(data.reviewedAt),
      reviewedBy: typeof data.reviewedBy === "string" ? data.reviewedBy : null,
    };
  })
    .filter((row) => status === "all" || row.status === status)
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
    .slice(0, 300);

  return success("Loaded promotion requests.", rows);
});

export const resolveSchoolAdminPromotionRequest = onCall(async (request) => {
  assertSuperAdmin(request.auth);
  assertSignedIn(request.auth);

  const requestId = typeof request.data?.requestId === "string" ? request.data.requestId.trim() : "";
  const approve = request.data?.approve === true;
  if (!requestId) {
    throw new HttpsError("invalid-argument", "Promotion request id is required.");
  }

  const requestRef = firestore.doc(`schoolAdminPromotionRequests/${requestId}`);
  const requestSnapshot = await requestRef.get();
  if (!requestSnapshot.exists) {
    throw new HttpsError("not-found", "Promotion request not found.");
  }

  const data = requestSnapshot.data() ?? {};
  const targetUid = typeof data.uid === "string" ? data.uid : "";
  const schoolId = typeof data.schoolId === "string" ? data.schoolId : "";
  if (!targetUid || !schoolId) {
    throw new HttpsError("failed-precondition", "Promotion request is missing user or school metadata.");
  }

  if (approve) {
    const userRecord = await auth.getUser(targetUid);
    const claims = { ...(userRecord.customClaims ?? {}) } as Record<string, unknown>;
    claims.schoolAdmin = true;
    claims.schoolId = schoolId;
    await auth.setCustomUserClaims(targetUid, claims);
    await firestore.doc(`users/${targetUid}`).set({
      isSchoolAdmin: true,
      schoolId,
      lastClaimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  await requestRef.set({
    status: approve ? "approved" : "rejected",
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: request.auth.uid,
  }, { merge: true });

  return success(approve ? "Promotion approved." : "Promotion rejected.", approve ? "Promotion approved." : "Promotion rejected.");
});

export const setUserSuperAdminStatus = onCall(async (request) => {
  assertOwnerSuperAdminOperator(request.auth);
  assertSignedIn(request.auth);

  const uid = typeof request.data?.uid === "string" ? request.data.uid.trim() : "";
  const isSuperAdmin = request.data?.isSuperAdmin === true;
  if (!uid) {
    throw new HttpsError("invalid-argument", "A user id is required.");
  }

  if (uid !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Owner super admin changes are restricted to the owner account only.");
  }

  const userRecord = await auth.getUser(uid);
  const callerEmail = normalizeIdentity(request.auth.token?.email);
  const targetEmail = normalizeIdentity(userRecord.email);
  if (callerEmail && targetEmail && callerEmail !== targetEmail) {
    throw new HttpsError("permission-denied", "Owner super admin changes must target the signed-in owner account.");
  }

  const nextClaims = { ...(userRecord.customClaims ?? {}) } as Record<string, unknown>;
  if (isSuperAdmin) {
    nextClaims.superAdmin = true;
  } else {
    delete nextClaims.superAdmin;
  }

  await auth.setCustomUserClaims(uid, nextClaims);
  await firestore.doc(`users/${uid}`).set(
    {
      uid,
      email: userRecord.email ?? "",
      displayName: userRecord.displayName ?? "",
      isSuperAdmin,
      lastClaimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return success(isSuperAdmin ? "Granted super admin access." : "Removed super admin access.", isSuperAdmin ? "Granted super admin access." : "Removed super admin access.");
});

export const listAllSchoolsForSuperAdmin = onCall(async (request) => {
  assertSuperAdmin(request.auth);

  const snapshot = await firestore.collection("schools").orderBy("schoolName").limit(500).get();
  const rows: SchoolDirectoryRow[] = snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      schoolId: docSnap.id,
      schoolName: typeof data.schoolName === "string" ? data.schoolName : docSnap.id,
      districtName: typeof data.districtName === "string" ? data.districtName : null,
      memberCount: typeof data.memberCount === "number" ? data.memberCount : 0,
    };
  });

  return success("Loaded schools.", rows);
});

export const getSuperAdminDashboardStats = onCall(async (request) => {
  assertSuperAdmin(request.auth);

  const todayKey = getUtcDateKey();

  let schoolsCount = 0;
  try {
    schoolsCount = (await firestore.collection("schools").count().get()).data().count;
  } catch {
    schoolsCount = (await firestore.collection("schools").get()).size;
  }

  let textbooksCount = 0;
  try {
    // Textbooks are stored in top-level /textbooks documents.
    textbooksCount = (await firestore.collection("textbooks").count().get()).data().count;
  } catch {
    textbooksCount = (await firestore.collection("textbooks").get()).size;
  }

  let pendingPromotionRequests = 0;
  try {
    pendingPromotionRequests = (await firestore.collection("schoolAdminPromotionRequests").where("status", "==", "pending").count().get()).data().count;
  } catch {
    pendingPromotionRequests = (await firestore.collection("schoolAdminPromotionRequests").where("status", "==", "pending").get()).size;
  }

  // Avoid collection-group index requirements by filtering dateKey in memory.
  // Wrapped in try/catch: a missing COLLECTION_GROUP_ASC index on syncUsage.dateKey
  // causes a FAILED_PRECONDITION crash that would otherwise discard all other stats.
  let syncUsageDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    const syncUsageSnapshot = await firestore.collectionGroup("syncUsage").get();
    syncUsageDocs = syncUsageSnapshot.docs;
  } catch (syncUsageErr) {
    console.error(
      "[super-admin] syncUsage collection group query failed — tracked usage will show 0",
      syncUsageErr,
    );
  }

  let aiUsageDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    const aiUsageSnapshot = await firestore.collectionGroup("aiUsage").get();
    aiUsageDocs = aiUsageSnapshot.docs;
  } catch (aiUsageErr) {
    console.error(
      "[super-admin] aiUsage collection group query failed — tracked AI usage will show 0",
      aiUsageErr,
    );
  }

  let usersCount = 0;
  let nextPageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    usersCount += page.users.length;
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  let trackedReadsToday = 0;
  let trackedWritesToday = 0;
  syncUsageDocs.forEach((docSnap) => {
    const data = docSnap.data();
    if (typeof data.dateKey !== "string" || data.dateKey !== todayKey) {
      return;
    }
    const reads = typeof data.readCount === "number" ? Math.max(0, Math.floor(data.readCount)) : 0;
    const writes = typeof data.writeCount === "number" ? Math.max(0, Math.floor(data.writeCount)) : 0;
    trackedReadsToday += reads;
    trackedWritesToday += writes;
  });

  let trackedAiRequestsToday = 0;
  let trackedAiBucketHitsToday = 0;
  aiUsageDocs.forEach((docSnap) => {
    const data = docSnap.data();
    if (typeof data.lastResetDate !== "string" || data.lastResetDate !== todayKey) {
      return;
    }

    const requests = typeof data.aiRequestsToday === "number" ? Math.max(0, Math.floor(data.aiRequestsToday)) : 0;
    const bucketHits = typeof data.aiBucketHitsToday === "number" ? Math.max(0, Math.floor(data.aiBucketHitsToday)) : 0;
    trackedAiRequestsToday += requests;
    trackedAiBucketHitsToday += bucketHits;
  });

  console.info("[super-admin] dashboard stats computed", {
    usersCount,
    schoolsCount,
    textbooksCount,
    pendingPromotionRequests,
    trackedReadsToday,
    trackedWritesToday,
    trackedAiRequestsToday,
    trackedAiBucketHitsToday,
    syncUsageDocsScanned: syncUsageDocs.length,
    aiUsageDocsScanned: aiUsageDocs.length,
    todayKey,
  });

  const stats: SuperAdminDashboardStats = {
    usersCount,
    schoolsCount,
    textbooksCount,
    pendingPromotionRequests,
    trackedReadsToday,
    trackedWritesToday,
    trackedAiRequestsToday,
    trackedAiBucketHitsToday,
  };

  return success("Loaded super admin stats.", stats);
});

export const getSuperAdminGlobalQuota = onCall(async (request) => {
  assertSuperAdmin(request.auth);

  const projectId = process.env.GCLOUD_PROJECT ?? "";
  if (!projectId) {
    const fallback: SuperAdminGlobalQuotaResult = {
      projectId: "",
      fetchedAt: new Date().toISOString(),
      source: "fallback",
      readLimitPerDay: DEFAULT_FIRESTORE_READ_LIMIT_PER_DAY,
      writeLimitPerDay: DEFAULT_FIRESTORE_WRITE_LIMIT_PER_DAY,
      deleteLimitPerDay: DEFAULT_FIRESTORE_DELETE_LIMIT_PER_DAY,
      functionInvocationsLimitPerMonth: DEFAULT_FUNCTION_INVOCATIONS_LIMIT_PER_MONTH,
      message: "Using fallback quota defaults. Set project/runtime access to read live global limits from Service Usage API.",
      details: [],
    };

    return success("Loaded global quota fallback.", fallback);
  }

  try {
    const accessToken = await admin.credential.applicationDefault().getAccessToken();
    const serviceUsageProject = await resolveServiceUsageProjectResource(projectId, accessToken.access_token ?? "");
    const url = `https://serviceusage.googleapis.com/v1/${serviceUsageProject}/services/firestore.googleapis.com/consumerQuotaMetrics?view=FULL`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken.access_token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Service Usage API returned ${response.status}`);
    }

    const payload = await response.json() as unknown;
    const parsed = parseFirestoreQuotaResponse(payload);

    const result: SuperAdminGlobalQuotaResult = {
      projectId,
      fetchedAt: new Date().toISOString(),
      source: "serviceusage",
      readLimitPerDay: parsed.readLimitPerDay,
      writeLimitPerDay: parsed.writeLimitPerDay,
      deleteLimitPerDay: DEFAULT_FIRESTORE_DELETE_LIMIT_PER_DAY,
      functionInvocationsLimitPerMonth: DEFAULT_FUNCTION_INVOCATIONS_LIMIT_PER_MONTH,
      message: null,
      details: parsed.details,
    };

    return success("Loaded global Firestore quota.", result);
  } catch {
    const fallback: SuperAdminGlobalQuotaResult = {
      projectId,
      fetchedAt: new Date().toISOString(),
      source: "fallback",
      readLimitPerDay: DEFAULT_FIRESTORE_READ_LIMIT_PER_DAY,
      writeLimitPerDay: DEFAULT_FIRESTORE_WRITE_LIMIT_PER_DAY,
      deleteLimitPerDay: DEFAULT_FIRESTORE_DELETE_LIMIT_PER_DAY,
      functionInvocationsLimitPerMonth: DEFAULT_FUNCTION_INVOCATIONS_LIMIT_PER_MONTH,
      message: "Global quota API data unavailable. Using fallback defaults until Service Usage API access succeeds.",
      details: [],
    };

    return success("Loaded global quota fallback.", fallback);
  }
});

export const getSuperAdminAzureQuota = onCall({ secrets: [azureCosmosConnectionStringSecret] }, async (request) => {
  assertSuperAdmin(request.auth);

  const projectId = process.env.GCLOUD_PROJECT ?? "";
  const { connectionString: azureConnectionString, endpoint: azureEndpoint, key: azureKey } = getAzureCosmosCredentials();
  const configured = azureConnectionString.trim().length > 0 || (azureEndpoint.trim().length > 0 && azureKey.trim().length > 0);
  const backupConfig = normalizeBackupConfig((await getBackupConfigDocRef().get()).data());
  const mirrorEnabled = backupConfig.mirrorEnabled && backupConfig.cosmosEnabled;
  const databaseId = process.env.AZURE_COSMOS_DATABASE_ID?.trim() || DEFAULT_AZURE_COSMOS_DATABASE_ID;
  const containerId = process.env.AZURE_COSMOS_CONTAINER_ID?.trim() || DEFAULT_AZURE_COSMOS_CONTAINER_ID;
  const requestUnitsPerSecondLimit = parsePositiveEnvNumber("AZURE_COSMOS_RU_PER_SECOND_LIMIT");
  const requestUnitsPerDayLimit = parsePositiveEnvNumber("AZURE_COSMOS_RU_PER_DAY_LIMIT");
  const storageGbLimit = parsePositiveEnvNumber("AZURE_COSMOS_STORAGE_GB_LIMIT");

  let usage = {
    readsToday: 0,
    writesToday: 0,
    requestUnitsToday: 0,
    errorsToday: 0,
  };
  let usageMessage: string | null = null;

  try {
    usage = await readAzureUsageTotals();
  } catch {
    usageMessage = "Azure usage telemetry docs are unavailable. Ensure azureUsage/current docs are being written per user.";
  }

  const result: SuperAdminAzureQuotaResult = {
    projectId,
    fetchedAt: new Date().toISOString(),
    source: configured ? "env" : "fallback",
    configured,
    mirrorEnabled,
    databaseId,
    containerId,
    requestUnitsPerSecondLimit,
    requestUnitsPerDayLimit,
    storageGbLimit,
    currentReadsToday: usage.readsToday,
    currentWritesToday: usage.writesToday,
    currentRequestUnitsToday: usage.requestUnitsToday,
    currentErrorsToday: usage.errorsToday,
    message: usageMessage ?? (configured
      ? (mirrorEnabled
        ? "Azure Cosmos configuration detected. Mirror path is enabled; confirm live traffic by checking non-zero Azure usage counters."
        : "Azure Cosmos configuration detected but mirror path is disabled. Enable Mirror + Cosmos availability in Super Admin Backup Controls to activate backup writes.")
        : "Azure Cosmos is not configured yet. Set AZURE_COSMOS_CONNECTION_STRING secret (or AZURE_COSMOS_ENDPOINT + AZURE_COSMOS_KEY secrets) and limits env vars to enable quota tracking."),
  };

  return success("Loaded Azure Cosmos quota and telemetry status.", result);
});

export const getSuperAdminBackupConfig = onCall(async (request) => {
  assertSuperAdmin(request.auth);

  const snapshot = await getBackupConfigDocRef().get();
  const config = normalizeBackupConfig(snapshot.data());
  return success("Loaded backup configuration.", config);
});

export const setSuperAdminBackupConfig = onCall(async (request) => {
  assertSuperAdmin(request.auth);
  const data = typeof request.data === "object" && request.data !== null ? request.data as Record<string, unknown> : {};
  const existing = normalizeBackupConfig((await getBackupConfigDocRef().get()).data());

  const primaryDb: BackupPrimaryDb = data.primaryDb === "cosmos" ? "cosmos" : data.primaryDb === "firestore" ? "firestore" : existing.primaryDb;
  const backupMode: BackupMode = data.backupMode === "manual" ? "manual" : data.backupMode === "interval" ? "interval" : existing.backupMode;
  const requestedFrequency = typeof data.frequencyMinutes === "number"
    ? Math.floor(data.frequencyMinutes)
    : existing.frequencyMinutes;
  const frequencyMinutes = Math.max(BACKUP_FREQUENCY_MINUTES_MIN, Math.min(BACKUP_FREQUENCY_MINUTES_MAX, requestedFrequency));
  const merged: SuperAdminBackupConfigResult = {
    primaryDb,
    mirrorEnabled: typeof data.mirrorEnabled === "boolean" ? data.mirrorEnabled : existing.mirrorEnabled,
    firestoreEnabled: typeof data.firestoreEnabled === "boolean" ? data.firestoreEnabled : existing.firestoreEnabled,
    cosmosEnabled: typeof data.cosmosEnabled === "boolean" ? data.cosmosEnabled : existing.cosmosEnabled,
    backupMode,
    frequencyMinutes,
    lastBackupAt: existing.lastBackupAt,
    nextBackupAt: existing.lastBackupAt
      ? new Date(Date.parse(existing.lastBackupAt) + frequencyMinutes * 60 * 1000).toISOString()
      : null,
    updatedBy: request.auth?.uid ?? "system",
    updatedAt: new Date().toISOString(),
  };

  await getBackupConfigDocRef().set(merged, { merge: true });
  return success("Saved backup configuration.", merged);
});

export const runSuperAdminBackupNow = onCall({ secrets: [azureCosmosConnectionStringSecret] }, async (request) => {
  assertSuperAdmin(request.auth);
  const config = normalizeBackupConfig((await getBackupConfigDocRef().get()).data());
  if (!config.mirrorEnabled || !config.cosmosEnabled) {
    throw new HttpsError("failed-precondition", "Backup mirror is disabled. Enable Cosmos + mirror before running backup.");
  }

  const result = await runAzureBackupMirror(request.auth?.uid ?? "superadmin");
  return success("Executed backup run.", result);
});

export const listSuperAdminBackupJobs = onCall(async (request) => {
  assertSuperAdmin(request.auth);
  const requestedLimit = typeof request.data?.limit === "number" ? Math.floor(request.data.limit) : 10;
  const limitCount = Math.max(1, Math.min(50, requestedLimit));
  const snapshot = await getBackupJobsCollectionRef().orderBy("startedAt", "desc").limit(limitCount).get();
  const rows = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  return success("Loaded backup jobs.", rows);
});

export const runScheduledAzureBackup = onSchedule({ schedule: "every 15 minutes", secrets: [azureCosmosConnectionStringSecret] }, async () => {
  const config = normalizeBackupConfig((await getBackupConfigDocRef().get()).data());
  if (!config.mirrorEnabled || !config.cosmosEnabled || config.backupMode !== "interval") {
    return;
  }

  const nowMs = Date.now();
  const lastBackupMs = config.lastBackupAt ? Date.parse(config.lastBackupAt) : 0;
  if (lastBackupMs > 0 && nowMs - lastBackupMs < config.frequencyMinutes * 60 * 1000) {
    return;
  }

  try {
    await runAzureBackupMirror("schedule");
  } catch (error) {
    if (error instanceof HttpsError && error.code === "failed-precondition") {
      return;
    }

    await getBackupJobsCollectionRef().add({
      triggeredBy: "schedule",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "failed",
      docsScanned: 0,
      docsMirrored: 0,
      docsFailed: 0,
      requestUnitsUsed: 0,
      message: error instanceof Error ? error.message : String(error),
    });
  }
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
  await touchOwnerSyncTokenFromDocPath(docPath);

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
  await touchOwnerSyncTokenFromDocPath(docPath);

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
  await touchOwnerSyncTokenFromDocPath(docPath);

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
  await touchOwnerSyncTokenFromDocPath(docPath);

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

export const getCurrentAiSafetyStatus = onCall(async (request) => {
  assertSignedIn(request.auth);

  const usageSnapshot = await firestore.doc(`users/${request.auth.uid}/aiUsage/current`).get();
  const usage = applyAiUsageResets(normalizeAiUsage(usageSnapshot.exists ? usageSnapshot.data() : null));
  const policy = await getAiSafetyPolicyRecord();
  const override = await getAiSafetyOverrideForUser(request.auth.uid);
  const status = buildCurrentAiSafetyStatusResult(usage, policy, override);

  if (!usageSnapshot.exists || usageSnapshot.data()?.lastResetDate !== usage.lastResetDate) {
    await firestore.doc(`users/${request.auth.uid}/aiUsage/current`).set(usage, { merge: true });
  }

  return success("Loaded current AI safety status.", status);
});

export const getSuperAdminAiProviderLimits = onCall(async (request) => {
  assertSuperAdmin(request.auth);

  const policy = await getAiSafetyPolicyRecord();
  const models = await listOpenAiRateLimitSnapshots();
  const githubStatus = await getGitHubRateLimitStatus();

  let aiUsageDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    const aiUsageSnapshot = await firestore.collectionGroup("aiUsage").get();
    aiUsageDocs = aiUsageSnapshot.docs;
  } catch (error) {
    console.error("[super-admin] aiUsage aggregate query failed", error);
  }

  const todayKey = getUtcDateKey();
  let aiRequestsToday = 0;
  let aiTokensToday = 0;
  let aiBucketHitsToday = 0;
  let aiFailuresToday = 0;
  let providerRateLimitedToday = 0;
  let openAiRequestsToday = 0;
  let openAiTokensToday = 0;
  let githubRequestsToday = 0;
  let githubTokensToday = 0;
  let openAiRateLimitedToday = 0;
  let githubRateLimitedToday = 0;

  aiUsageDocs.forEach((docSnap) => {
    const usage = normalizeAiUsage(docSnap.data());
    if (usage.lastResetDate !== todayKey) {
      return;
    }

    aiRequestsToday += usage.aiRequestsToday;
    aiTokensToday += usage.aiTokensToday;
    aiBucketHitsToday += usage.aiBucketHitsToday;
    aiFailuresToday += usage.aiFailuresToday;
    providerRateLimitedToday += usage.providerRateLimitedToday;
    openAiRequestsToday += usage.openAiRequestsToday;
    openAiTokensToday += usage.openAiTokensToday;
    githubRequestsToday += usage.githubRequestsToday;
    githubTokensToday += usage.githubTokensToday;
    openAiRateLimitedToday += usage.openAiRateLimitedToday;
    githubRateLimitedToday += usage.githubRateLimitedToday;
  });

  const result: SuperAdminAiProviderLimitsResult = {
    provider: "openai",
    capturedAt: new Date().toISOString(),
    policy,
    models,
    github: {
      tier: policy.githubCopilotTier,
      requestsPerMinuteLimit: policy.githubRequestsPerMinuteLimit,
      requestsPerDayLimit: policy.githubDailyRequestLimit,
      tokensPerRequestInputLimit: policy.githubTokensPerRequestInputLimit,
      tokensPerRequestOutputLimit: policy.githubTokensPerRequestOutputLimit,
      concurrentRequestsLimit: policy.githubConcurrentRequestsLimit,
    },
    githubStatus,
    aggregateToday: {
      aiRequestsToday,
      aiTokensToday,
      aiBucketHitsToday,
      aiFailuresToday,
      providerRateLimitedToday,
      openAiRequestsToday,
      openAiTokensToday,
      githubRequestsToday,
      githubTokensToday,
      openAiRateLimitedToday,
      githubRateLimitedToday,
    },
  };

  return success("Loaded super admin AI provider limits.", result);
});

export const setGlobalAiSafetyPolicy = onCall(async (request) => {
  assertSuperAdmin(request.auth);
  assertSignedIn(request.auth);

  const payload = request.data as Partial<AiSafetyPolicyRecord>;
  const current = await getAiSafetyPolicyRecord();
  const next = normalizeAiSafetyPolicy({
    ...current,
    ...payload,
    updatedBy: request.auth.uid,
    updatedAt: new Date().toISOString(),
  });

  await firestore.doc(AI_SAFETY_POLICY_DOC_PATH).set(next, { merge: true });
  return success("Updated global AI safety policy.", next);
});

export const setUserAiSafetyOverride = onCall(async (request) => {
  assertSuperAdmin(request.auth);
  assertSignedIn(request.auth);

  const payload = request.data as {
    uid?: unknown;
    dailyRequestLimit?: unknown;
    dailyTokenLimit?: unknown;
    monthlyBudgetUsd?: unknown;
    githubDailyRequestLimit?: unknown;
    githubDailyTokenLimit?: unknown;
  };

  const uid = typeof payload.uid === "string" ? payload.uid.trim() : "";
  if (!uid) {
    throw new HttpsError("invalid-argument", "A target uid is required.");
  }

  const next = normalizeAiSafetyOverride({
    dailyRequestLimit: typeof payload.dailyRequestLimit === "number" ? payload.dailyRequestLimit : null,
    dailyTokenLimit: typeof payload.dailyTokenLimit === "number" ? payload.dailyTokenLimit : null,
    monthlyBudgetUsd: typeof payload.monthlyBudgetUsd === "number" ? payload.monthlyBudgetUsd : null,
    githubDailyRequestLimit: typeof payload.githubDailyRequestLimit === "number" ? payload.githubDailyRequestLimit : null,
    githubDailyTokenLimit: typeof payload.githubDailyTokenLimit === "number" ? payload.githubDailyTokenLimit : null,
    updatedBy: request.auth.uid,
    updatedAt: new Date().toISOString(),
  });

  await firestore.doc(`users/${uid}/aiSafety/current`).set(next, { merge: true });
  return success("Updated user AI safety override.", { uid, override: next });
});

export const getAiProviderPolicy = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const snapshot = await firestore.doc(AI_PROVIDER_POLICY_DOC_PATH).get();
  const data = snapshot.data() ?? {};
  const normalized: AiProviderPolicyRecord = {
    providerOrder: normalizeAutoOcrProviderOrder(data.providerOrder),
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "system",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date(0).toISOString(),
  };

  return success("Loaded AI provider policy.", normalized);
});

function getCloudOcrProviderRuntime(providerId: AutoOcrProviderId): CloudOcrProviderRuntime | null {
  if (providerId === "cloud_openai_vision") {
    return {
      id: "cloud_openai_vision",
      label: "Cloud OCR (OpenAI Vision via Firebase Function)",
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o-mini",
      apiKey: getOpenAiApiKey(),
      missingCredentialReason: "OPENAI_API_KEY is not configured on the function runtime.",
    };
  }

  if (providerId === "cloud_github_models_vision") {
    return {
      id: "cloud_github_models_vision",
      label: "Cloud OCR (GitHub Models Vision)",
      endpoint: "https://models.github.ai/inference/chat/completions",
      model: "openai/gpt-4.1",
      apiKey: getGitHubModelsToken(),
      missingCredentialReason: "COURSEFORGE_GITHUB_TOKEN or GITHUB_TOKEN is not configured on the function runtime.",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
    };
  }

  return null;
}

function buildCloudOcrErrorDetails(
  runtime: CloudOcrProviderRuntime,
  details: CloudOcrExecutionDetails,
  failure: {
    reasonCode: string;
    reasonMessage: string;
    httpStatus: number | null;
    retryAfterSeconds?: number | null;
  }
): Record<string, unknown> {
  return {
    providerId: runtime.id,
    providerLabel: runtime.label,
    endpoint: runtime.endpoint,
    model: runtime.model,
    reasonCode: failure.reasonCode,
    reasonMessage: failure.reasonMessage,
    httpStatus: failure.httpStatus,
    retryAfterSeconds: typeof failure.retryAfterSeconds === "number" ? failure.retryAfterSeconds : null,
    traceId: details.traceId,
    failureStage: details.failureStage,
    requestAcceptedByFunction: details.requestAcceptedByFunction,
    providerRequestPrepared: details.providerRequestPrepared,
    providerRequestSent: details.providerRequestSent,
    providerResponseReceived: details.providerResponseReceived,
    providerExecutionObserved: details.providerExecutionObserved,
  };
}

async function executeCloudOcrExtraction(
  runtime: CloudOcrProviderRuntime,
  imageDataUrl: string,
  traceId: string,
  userId: string
): Promise<{ text: string; tokenCount: number; details: CloudOcrExecutionDetails }> {
  const details = createCloudOcrExecutionDetails(runtime, traceId);

  if (!runtime.apiKey) {
    details.failureStage = "preflight_credentials";
    throw new HttpsError(
      "failed-precondition",
      `Cloud OCR is unavailable because ${runtime.missingCredentialReason}`,
      buildCloudOcrErrorDetails(runtime, details, {
        reasonCode: runtime.id === "cloud_openai_vision" ? "missing_openai_api_key" : "missing_github_models_token",
        reasonMessage: runtime.missingCredentialReason,
        httpStatus: null,
      })
    );
  }

  await consumeOcrRequestQuota(userId);
  inferImageMimeType(imageDataUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response: Response;
  try {
    details.providerRequestPrepared = true;
    details.providerRequestSent = true;
    response = await fetch(runtime.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.apiKey}`,
        ...(runtime.headers ?? {}),
      },
      body: JSON.stringify({
        model: runtime.model,
        messages: [
          {
            role: "system",
            content: "You perform OCR from educational screenshots. Transcribe every readable character from the entire page. Preserve line breaks and include all columns, headers, footers, legal notices, addresses, URLs, ISBN/MHID lines, and image-credit text. For multi-column layouts, read left column top-to-bottom first, then right column top-to-bottom. Do not skip any section, sidebar, or inset box. Return only plain extracted text with no commentary.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract ALL readable text from this screenshot. Important:\n- Include URL or domain text near the top (e.g. mheducation.com/prek-12)\n- Include all legal/copyright paragraphs verbatim\n- Include any 'Send all inquiries to:' address block with every address line, city, state, ZIP\n- Include all ISBN and MHID lines\n- Include any text in right-hand columns or boxes (e.g. STEM descriptions)\n- Include printing/edition codes at the bottom\nDo not summarize. Do not omit any section. Return plain text only.",
              },
              { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
            ],
          },
        ],
        max_tokens: 3600,
        temperature: 0,
      }),
    });
    details.providerResponseReceived = true;
    details.providerExecutionObserved = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    details.failureStage = message.toLowerCase().includes("abort") ? "provider_timeout" : "provider_request";
    throw new HttpsError(
      message.toLowerCase().includes("abort") ? "deadline-exceeded" : "internal",
      message.toLowerCase().includes("abort")
        ? `${runtime.label} timed out before returning OCR output.`
        : `${runtime.label} request failed before the provider returned a response: ${message}`,
      buildCloudOcrErrorDetails(runtime, details, {
        reasonCode: message.toLowerCase().includes("abort") ? "request_timeout" : "request_failed",
        reasonMessage: message,
        httpStatus: null,
      })
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (runtime.id === "cloud_openai_vision") {
    void recordOpenAiRateLimitSnapshotBestEffort(runtime.model, response.headers);
  } else if (runtime.id === "cloud_github_models_vision") {
    void recordGitHubRateLimitStatusBestEffort({
      isRateLimited: false,
      retryAfterSeconds: null,
      source: "executeCloudOcrExtraction:success",
    });
  }

  if (!response.ok) {
    details.failureStage = "provider_response";
    const providerDetails = await readResponseSnippet(response);
    const reasonMessage = providerDetails || `${runtime.label} returned ${response.status} ${response.statusText}.`;
    console.warn("[OCR] Provider error", {
      traceId,
      providerId: runtime.id,
      status: response.status,
      statusText: response.statusText,
      providerDetails,
    });

    if (response.status === 401 || response.status === 403) {
      throw new HttpsError(
        "failed-precondition",
        `${runtime.label} authentication failed (${response.status} ${response.statusText}). ${providerDetails}`.trim(),
        buildCloudOcrErrorDetails(runtime, details, {
          reasonCode: "auth_failed",
          reasonMessage,
          httpStatus: response.status,
        })
      );
    }

    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers);
      if (runtime.id === "cloud_github_models_vision") {
        void recordGitHubRateLimitStatusBestEffort({
          isRateLimited: true,
          retryAfterSeconds,
          source: "executeCloudOcrExtraction:429",
        });
      }
      throw new HttpsError(
        "resource-exhausted",
        `${runtime.label} rate limit reached (${response.status} ${response.statusText}). ${providerDetails}`.trim(),
        buildCloudOcrErrorDetails(runtime, details, {
          reasonCode: "rate_limited",
          reasonMessage,
          httpStatus: response.status,
          retryAfterSeconds,
        })
      );
    }

    throw new HttpsError(
      response.status >= 500 ? "internal" : "failed-precondition",
      `${runtime.label} request failed (${response.status} ${response.statusText}). ${providerDetails}`.trim(),
      buildCloudOcrErrorDetails(runtime, details, {
        reasonCode: response.status >= 500 ? "provider_error" : "request_rejected",
        reasonMessage,
        httpStatus: response.status,
      })
    );
  }

  let json: { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
  try {
    json = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    details.failureStage = "response_parse";
    throw new HttpsError(
      "internal",
      `${runtime.label} returned a non-JSON OCR response. ${message}`,
      buildCloudOcrErrorDetails(runtime, details, {
        reasonCode: "invalid_json",
        reasonMessage: message,
        httpStatus: response.status,
      })
    );
  }

  if (!json || typeof json !== "object") {
    details.failureStage = "response_validate";
    throw new HttpsError(
      "internal",
      `${runtime.label} returned an invalid OCR response envelope.`,
      buildCloudOcrErrorDetails(runtime, details, {
        reasonCode: "invalid_response_envelope",
        reasonMessage: "Expected a JSON object response.",
        httpStatus: response.status,
      })
    );
  }

  if (!Array.isArray(json.choices) || json.choices.length === 0) {
    details.failureStage = "response_validate";
    const jsonStr = JSON.stringify(json).slice(0, 200);
    throw new HttpsError(
      "internal",
      `${runtime.label} response did not include any OCR choices. ${jsonStr}`,
      buildCloudOcrErrorDetails(runtime, details, {
        reasonCode: "missing_choices",
        reasonMessage: jsonStr,
        httpStatus: response.status,
      })
    );
  }

  const extractedText = json.choices[0]?.message?.content?.trim() ?? "";
  if (!extractedText) {
    details.failureStage = "response_validate";
    throw new HttpsError(
      "internal",
      `${runtime.label} returned empty OCR text.`,
      buildCloudOcrErrorDetails(runtime, details, {
        reasonCode: "empty_text",
        reasonMessage: "Provider response content was empty after trimming.",
        httpStatus: response.status,
      })
    );
  }

  const tokenCount = typeof json.usage?.total_tokens === "number"
    ? Math.max(0, Math.floor(json.usage.total_tokens))
    : 0;

  return { text: extractedText, tokenCount, details };
}

export const getAiProviderStatus = onCall({ invoker: "public", secrets: [openAiKeySecret, githubModelsTokenSecret] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to check AI provider status.");
  }

  const payload = request.data as { providerIds?: unknown } | undefined;
  const requestedProviderIds = Array.isArray(payload?.providerIds)
    ? payload?.providerIds.filter((providerId): providerId is AutoOcrProviderId => (
      providerId === "cloud_openai_vision" || providerId === "cloud_github_models_vision"
    ))
    : [];
  const providerIdsToProbe = requestedProviderIds.length > 0
    ? [...new Set(requestedProviderIds)]
    : ["cloud_openai_vision", "cloud_github_models_vision"];

  const providers: Array<{
    id: AutoOcrProviderId;
    label: string;
    available: boolean;
    availabilityState: "available" | "unavailable" | "unknown";
    reasonCode: string;
    reasonMessage: string;
    httpStatus: number | null;
    checkedAt: string;
    diagnostics?: unknown;
  }> = [];

  if (providerIdsToProbe.includes("cloud_openai_vision")) {
    const openAiProbe = await canAuthenticateOpenAi(getOpenAiApiKey());
    providers.push({
      id: "cloud_openai_vision" as const,
      label: "Cloud OCR (OpenAI Vision via Firebase Function)",
      available: openAiProbe.available,
      availabilityState: openAiProbe.availabilityState,
      reasonCode: openAiProbe.reasonCode,
      reasonMessage: openAiProbe.reasonMessage,
      httpStatus: openAiProbe.httpStatus,
      checkedAt: new Date().toISOString(),
      diagnostics: openAiProbe.details,
    });
  }

  if (providerIdsToProbe.includes("cloud_github_models_vision")) {
    const githubProbe = await canAuthenticateGitHubModels(getGitHubModelsToken());
    providers.push({
      id: "cloud_github_models_vision" as const,
      label: "Cloud OCR (GitHub Models Vision)",
      available: githubProbe.available,
      availabilityState: githubProbe.availabilityState,
      reasonCode: githubProbe.reasonCode,
      reasonMessage: githubProbe.reasonMessage,
      httpStatus: githubProbe.httpStatus,
      checkedAt: new Date().toISOString(),
      diagnostics: githubProbe.details,
    });
  }

  providers.push({
    id: "local_tesseract" as const,
    label: "Local OCR (Tesseract)",
    available: true,
    availabilityState: "available" as const,
    reasonCode: "local_provider",
    reasonMessage: "Local OCR is available on-device.",
    httpStatus: null,
    checkedAt: new Date().toISOString(),
  });

  return success("Loaded AI provider status.", {
    providers,
  });
});

export const setAiProviderPolicy = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data as { providerOrder?: unknown };
  const providerOrder = normalizeAutoOcrProviderOrder(data.providerOrder);
  const nextPolicy: AiProviderPolicyRecord = {
    providerOrder,
    updatedBy: request.auth?.uid ?? "unknown",
    updatedAt: new Date().toISOString(),
  };

  await firestore.doc(AI_PROVIDER_POLICY_DOC_PATH).set(nextPolicy, { merge: true });
  return success("Updated AI provider policy.", nextPolicy);
});

export const getDebugLoggingPolicy = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const policy = await getDebugLoggingPolicyRecord();
  return success("Loaded debug logging policy.", policy);
});

export const setDebugLoggingPolicy = onCall(async (request) => {
  assertAdmin(request.auth);

  const payload = request.data as Partial<DebugLoggingPolicyRecord>;
  const current = await getDebugLoggingPolicyRecord();
  const next = normalizeDebugLoggingPolicy({
    ...current,
    ...payload,
    updatedBy: request.auth?.uid ?? "unknown",
    updatedAt: new Date().toISOString(),
  });

  await firestore.doc(DEBUG_POLICY_DOC_PATH).set(next, { merge: true });
  return success("Updated debug logging policy.", next);
});

export const uploadDebugLogReport = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const payload = request.data as {
    userId?: unknown;
    entries?: unknown;
    totalSizeBytes?: unknown;
    appVersion?: unknown;
    browserInfo?: unknown;
    extensionVersion?: unknown;
    osInfo?: unknown;
  };

  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  if (!userId || userId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Debug upload user mismatch.");
  }

  const policy = await getDebugLoggingPolicyRecord();
  if (!policy.enabledGlobally || policy.disabledUserIds.includes(userId)) {
    throw new HttpsError("failed-precondition", "Debug logging is disabled for this account.");
  }

  const entries = sanitizeDebugLogEntries(payload.entries);
  if (!entries.length) {
    throw new HttpsError("invalid-argument", "Debug log entries are required.");
  }

  const calculatedTotalSize = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  const declaredTotalSize = typeof payload.totalSizeBytes === "number" ? Math.round(payload.totalSizeBytes) : calculatedTotalSize;
  const totalSizeBytes = Math.max(calculatedTotalSize, declaredTotalSize);

  if (totalSizeBytes > policy.maxUploadBytes) {
    throw new HttpsError("invalid-argument", "Debug log too large to upload. Please clear or reduce logging.");
  }

  const uploadedAtMs = Date.now();
  const reportId = `${uploadedAtMs}`;
  const docPath = `debugReports/${userId}/reports/${reportId}`;

  await firestore.doc(docPath).set({
    userId,
    uploadedAtMs,
    createdAt: new Date(uploadedAtMs).toISOString(),
    entries,
    entriesCount: entries.length,
    totalSizeBytes,
    appVersion: typeof payload.appVersion === "string" ? payload.appVersion : undefined,
    browserInfo: typeof payload.browserInfo === "string" ? payload.browserInfo : undefined,
    extensionVersion: typeof payload.extensionVersion === "string" ? payload.extensionVersion : null,
    osInfo: typeof payload.osInfo === "string" ? payload.osInfo : undefined,
  }, { merge: false });

  return success("Debug log uploaded.", {
    reportId,
    uploadedCount: entries.length,
    uploadedAt: uploadedAtMs,
  });
});

export const listRecentDebugUploads = onCall(async (request) => {
  assertAdmin(request.auth);

  const snapshot = await firestore
    .collectionGroup("reports")
    .orderBy("uploadedAtMs", "desc")
    .limit(50)
    .get();

  const rows: DebugUploadSummary[] = snapshot.docs
    .filter((docSnapshot) => docSnapshot.ref.parent.parent?.parent?.id === "debugReports")
    .map((docSnapshot) => {
      const data = docSnapshot.data();
      return {
        reportPath: docSnapshot.ref.path,
        userId: typeof data.userId === "string" ? data.userId : "",
        createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date(0).toISOString(),
        uploadedAtMs: typeof data.uploadedAtMs === "number" ? data.uploadedAtMs : 0,
        totalSizeBytes: typeof data.totalSizeBytes === "number" ? data.totalSizeBytes : 0,
        entriesCount: typeof data.entriesCount === "number" ? data.entriesCount : 0,
        appVersion: typeof data.appVersion === "string" ? data.appVersion : undefined,
      };
    });

  return success("Loaded recent debug uploads.", rows);
});

export const extractScreenshotText = onCall({ secrets: [openAiKeySecret, githubModelsTokenSecret], invoker: "public" }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to extract screenshot text.");
  }
  const uid = request.auth.uid;

  const payload = request.data as { imageDataUrl?: unknown; debugTraceId?: unknown; providerId?: unknown };
  const imageDataUrl = typeof payload.imageDataUrl === "string" ? payload.imageDataUrl.trim() : "";
  const debugTraceId = typeof payload.debugTraceId === "string" && payload.debugTraceId.trim()
    ? payload.debugTraceId.trim()
    : `ocr-cloud-${Date.now()}`;
  const providerId = payload.providerId === "cloud_github_models_vision" || payload.providerId === "cloud_openai_vision"
    ? payload.providerId
    : "cloud_openai_vision";

  if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
    throw new HttpsError("invalid-argument", "A valid image data URL is required.");
  }

  if (Buffer.byteLength(imageDataUrl, "utf8") > MAX_OCR_IMAGE_DATA_URL_BYTES) {
    throw new HttpsError("invalid-argument", "Screenshot payload is too large. Please crop before retrying.");
  }

  const runtime = getCloudOcrProviderRuntime(providerId);
  if (!runtime) {
    throw new HttpsError("invalid-argument", `Unsupported OCR provider '${String(payload.providerId ?? "")}'.`, {
      providerId: payload.providerId ?? null,
      traceId: debugTraceId,
      reasonCode: "unsupported_provider",
      reasonMessage: "The requested OCR provider is not supported by this callable.",
      failureStage: "provider_select",
    });
  }

  console.log("[OCR] Starting screenshot text extraction", {
    traceId: debugTraceId,
    providerId: runtime.id,
    userId: uid,
    imageSize: imageDataUrl.length,
  });

  const requestKey = buildAiRequestKey("screenshot_text", uid, `${runtime.id}:${imageDataUrl}`);
  const { promise, isPrimary } = getOrStartAiRequest(requestKey, () => executeCloudOcrExtraction(runtime, imageDataUrl, debugTraceId, uid));

  const screenshotProvider: AiUsageProvider = runtime.id === "cloud_github_models_vision" ? "github" : "openai";

  if (!isPrimary) {
    void recordAiUsageBestEffort(uid, {
      kind: "screenshot_text",
      provider: screenshotProvider,
      requestCount: 1,
      bucketHitCount: 1,
    });
  }

  try {
    const result = await promise;

    if (isPrimary) {
      void recordAiUsageBestEffort(uid, {
        kind: "screenshot_text",
        provider: screenshotProvider,
        requestCount: 1,
        tokenCount: result.tokenCount,
        executionCount: 1,
      });
    }

    return success("Screenshot text extracted.", {
      text: result.text,
      providerId: runtime.id,
      diagnostics: result.details,
    });
  } catch (error) {
    if (isPrimary) {
      void recordAiUsageBestEffort(uid, recordAiProviderFailure({
        kind: "screenshot_text",
        provider: screenshotProvider,
        requestCount: 1,
        executionCount: 1,
      }, error));
    }
    throw error;
  }
});

export const extractMetadataFromImageVision = onCall({ secrets: [openAiKeySecret] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to extract metadata from images.");
  }
  const uid = request.auth.uid;

  const payload = request.data as {
    imageDataUrl?: unknown;
    context?: {
      pageType?: unknown;
      publisherHint?: unknown;
    };
  };

  const imageDataUrl = typeof payload.imageDataUrl === "string" ? payload.imageDataUrl.trim() : "";
  if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
    throw new HttpsError("invalid-argument", "A valid image data URL is required.");
  }

  if (Buffer.byteLength(imageDataUrl, "utf8") > MAX_OCR_IMAGE_DATA_URL_BYTES) {
    throw new HttpsError("invalid-argument", "Screenshot payload is too large. Please crop before retrying.");
  }

  const pageType = payload.context?.pageType === "cover" || payload.context?.pageType === "title" || payload.context?.pageType === "other"
    ? payload.context.pageType
    : "other";
  const publisherHint = typeof payload.context?.publisherHint === "string" ? payload.context.publisherHint.trim() : "";

  const openaiKey = getOpenAiApiKey();
  if (!openaiKey) {
    throw new HttpsError("failed-precondition", "Vision metadata extraction is unavailable because OPENAI_API_KEY is not configured.");
  }
  const requestKey = buildAiRequestKey("image_metadata", uid, `${imageDataUrl}:${pageType}:${publisherHint}`);
  const { promise, isPrimary } = getOrStartAiRequest(requestKey, async () => {
    await consumeOcrRequestQuota(uid);
    inferImageMimeType(imageDataUrl);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a specialized textbook metadata extractor. Extract textbook metadata from cover and copyright-page images with high precision. Return strict JSON only, no markdown fences or extra text.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "Extract textbook metadata from this image. Return JSON with these fields (all as strings except confidence/numbers, or null if not found):",
                  "title, subtitle, edition, publisher, publisherLocation, series, gradeLevel, subject, copyrightYear, isbn, additionalIsbns, relatedIsbns, platformUrl, mhid, confidence, rawText.",
                  "",
                  "CRITICAL EXTRACTION RULES:",
                  "1. TITLE: Main title of the textbook (not subtitle or edition)",
                  "2. SUBTITLE: Secondary subtitle if present (e.g., 'with Earth Science')",
                  "3. EDITION: Edition information (e.g., '3rd Edition')",
                  "4. PUBLISHER: Publisher name (e.g., 'McGraw-Hill Education', 'Pearson')",
                  "5. PUBLISHER LOCATION: Full mailing/business address including street address, city, state, ZIP code",
                  "6. SERIES: Series name if identifiable from title start word",
                  "7. GRADE LEVEL: Grade span (e.g., 'Grades 7-9', 'Pre-K-12', '8')",
                  "8. SUBJECT: Primary subject area (e.g., 'Science', 'Math', 'English', 'Social Studies') - set to null, we fill this separately",
                  "9. COPYRIGHT YEAR: Year from copyright line (e.g., 2021), must be 4 digits",
                  "10. ISBN: Primary ISBN-13 or ISBN-10 (REQUIRED - look for 978/979 prefix or 10-digit with checksum)",
                  "11. ADDITIONAL ISBNS: Other ISBN numbers on page (array of strings)",
                  "12. RELATED ISBNS: Array of {isbn, type, note} where type is: student|teacher|digital|workbook|assessment|other",
                  "13. PLATFORM URL: Publisher website URL (e.g., 'https://mheducation.com', starts with http/www or .com/.edu etc)",
                  "14. MHID: McGraw-Hill ID if present",
                  "15. rawText: CRITICAL â€” Copy ALL visible text from the image verbatim, preserving every line break. Include every line: URL, full address block, every ISBN line, MHID line, legal notices, footer codes. Do NOT summarize or truncate.",
                  "",
                  "FIELD EXTRACTION DETAILS:",
                  "- For PUBLISHER LOCATION: Look for 'Send all inquiries to:' section or address blocks with street + city, state ZIP",
                  "- For COPYRIGHT PAGE images, always extract address if visible",
                  "- For ISBN: Never skip - search entire image for 10-13 digit sequences, ISBN labels",
                  "- For platformUrl: Look for domain names, website text, typically 'mheducation.com' or similar",
                  "- For copyrightYear: Extract from 'Copyright Â© YYYY' or 'Â© YYYY'",
                  "- confidence: 0.0-1.0 based on overall extraction quality",
                  "",
                  `- pageType context: ${pageType} (use this to focus extraction on relevant fields)`,
                  publisherHint ? `- publisherHint context: ${publisherHint} (verified publisher name for this book)` : "",
                ].filter(Boolean).join("\n"),
              },
              { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
            ],
          },
        ],
        max_tokens: 2500,
        temperature: 0,
        response_format: {
          type: "json_object",
        },
      }),
    });

    if (!response.ok) {
      const providerDetails = await readResponseSnippet(response);
      throw new HttpsError("internal", `Vision provider error (${response.status} ${response.statusText}). ${providerDetails}`.trim());
    }

    void recordOpenAiRateLimitSnapshotBestEffort("gpt-4o-mini", response.headers);

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    const rawContent = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!rawContent) {
      throw new HttpsError("internal", "Vision provider returned empty metadata.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      throw new HttpsError("internal", "Vision provider returned non-JSON metadata.");
    }

    return {
      metadata: sanitizeMetadataResult(parsed, "vision"),
      tokenCount: typeof json.usage?.total_tokens === "number" ? Math.max(0, Math.floor(json.usage.total_tokens)) : 0,
    };
  });

  if (!isPrimary) {
    void recordAiUsageBestEffort(request.auth.uid, {
      kind: "image_metadata",
      provider: "openai",
      requestCount: 1,
      bucketHitCount: 1,
    });
  }

  try {
    const { metadata, tokenCount } = await promise;

    if (isPrimary) {
      void recordAiUsageBestEffort(request.auth.uid, {
        kind: "image_metadata",
        provider: "openai",
        requestCount: 1,
        tokenCount,
        executionCount: 1,
      });
    }

    return success("Image metadata extracted.", {
      metadata,
      confidence: metadata.confidence,
      rawText: metadata.rawText,
    });
  } catch (error) {
    if (isPrimary) {
      void recordAiUsageBestEffort(request.auth.uid, recordAiProviderFailure({
        kind: "image_metadata",
        provider: "openai",
        requestCount: 1,
        executionCount: 1,
      }, error));
    }
    throw error;
  }
});

export const correctionsUpload = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to sync metadata corrections.");
  }

  const payload = request.data as { corrections?: unknown };
  const corrections = sanitizeMetadataCorrectionRecords(payload.corrections);
  if (!corrections.length) {
    return success("No corrections to upload.", { acceptedCount: 0, rejectedCount: 0 });
  }

  const limitsDoc = await firestore.doc(METADATA_CORRECTION_LIMITS_DOC_PATH).get();
  const limitsData = limitsDoc.data() ?? {};
  const dailyLimit = typeof limitsData.dailyLimit === "number" ? Math.max(1, Math.round(limitsData.dailyLimit)) : DEFAULT_CORRECTION_DAILY_LIMIT;
  const minUploadIntervalSeconds = typeof limitsData.minUploadIntervalSeconds === "number"
    ? Math.max(1, Math.round(limitsData.minUploadIntervalSeconds))
    : DEFAULT_CORRECTION_MIN_UPLOAD_INTERVAL_SECONDS;

  const uploadRuntimeRef = firestore.doc(`users/${request.auth.uid}/metadataCorrectionUsageRuntime/state`);
  const uploadRuntimeSnapshot = await uploadRuntimeRef.get();
  const lastUploadAtMs = uploadRuntimeSnapshot.exists && typeof uploadRuntimeSnapshot.data()?.lastUploadAtMs === "number"
    ? Math.max(0, Math.round(uploadRuntimeSnapshot.data()!.lastUploadAtMs))
    : 0;
  const nowMs = Date.now();
  if (lastUploadAtMs > 0 && (nowMs - lastUploadAtMs) < (minUploadIntervalSeconds * 1000)) {
    throw new HttpsError("resource-exhausted", "Correction upload rate limit reached. Please retry shortly.");
  }

  const todayKey = getDateKey();
  const usageRef = firestore.doc(`users/${request.auth.uid}/metadataCorrectionUsage/${todayKey}`);
  const usageSnapshot = await usageRef.get();
  const usedToday = usageSnapshot.exists && typeof usageSnapshot.data()?.count === "number"
    ? Math.max(0, Math.round(usageSnapshot.data()!.count))
    : 0;

  const remaining = Math.max(0, dailyLimit - usedToday);
  if (remaining <= 0) {
    throw new HttpsError("resource-exhausted", "Daily correction upload limit reached.");
  }

  const accepted = corrections.slice(0, remaining);
  const rejectedCount = corrections.length - accepted.length;

  const batch = firestore.batch();
  for (const correction of accepted) {
    const validation = validateCorrectionForQueue(correction);
    const suspicious = detectSuspiciousCorrection(correction);
    const flagged = correction.flagged || !validation.valid || suspicious.suspicious;
    const reasonFlagged = correction.reasonFlagged ?? validation.reason ?? suspicious.reason;
    const docRef = firestore.doc(`metadataCorrections/${request.auth.uid}/items/${correction.id}`);
    batch.set(docRef, {
      ...correction,
      flagged,
      reasonFlagged,
      reviewStatus: "pending",
      userId: request.auth.uid,
      createdAt: correction.timestamp,
      syncedAt: new Date().toISOString(),
    }, { merge: true });
  }

  batch.set(usageRef, {
    count: usedToday + accepted.length,
    date: todayKey,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  batch.set(uploadRuntimeRef, {
    lastUploadAtMs: nowMs,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  await batch.commit();

  const rulesDoc = await firestore.doc(METADATA_CORRECTION_RULES_DOC_PATH).get();
  const priorRules = sanitizeMetadataCorrectionRules(rulesDoc.data());
  const nextRules = buildRulesFromCorrections(accepted.filter((entry) => entry.reviewStatus !== "rejected"), priorRules);

  await firestore.doc(METADATA_CORRECTION_RULES_DOC_PATH).set(nextRules, { merge: true });

  return success("Correction samples queued for review.", {
    acceptedCount: accepted.length,
    rejectedCount,
  });
});

export const correctionsList = onCall(async (request) => {
  assertAdmin(request.auth);

  const payload = request.data as {
    page?: unknown;
    pageSize?: unknown;
    sortBy?: unknown;
    sortDirection?: unknown;
    filters?: {
      publisher?: unknown;
      pageType?: unknown;
      confidenceMin?: unknown;
      confidenceMax?: unknown;
      source?: unknown;
      flaggedOnly?: unknown;
      reviewStatus?: unknown;
      dateFrom?: unknown;
      dateTo?: unknown;
    };
  };

  const allSnaps = await firestore.collectionGroup("items").limit(1000).get();
  const allRecords = allSnaps.docs
    .filter((snapshot) => snapshot.ref.path.includes("metadataCorrections/"))
    .map((snapshot) => sanitizeMetadataCorrectionRecords([snapshot.data()])[0])
    .filter((entry): entry is MetadataCorrectionRecord => Boolean(entry));

  const filtered = filterAndSortCorrections(allRecords, {
    publisher: typeof payload.filters?.publisher === "string" ? payload.filters.publisher : undefined,
    pageType: typeof payload.filters?.pageType === "string" ? payload.filters.pageType : "all",
    confidenceMin: typeof payload.filters?.confidenceMin === "number" ? payload.filters.confidenceMin : undefined,
    confidenceMax: typeof payload.filters?.confidenceMax === "number" ? payload.filters.confidenceMax : undefined,
    source: typeof payload.filters?.source === "string" ? payload.filters.source : "all",
    flaggedOnly: payload.filters?.flaggedOnly === true,
    reviewStatus: typeof payload.filters?.reviewStatus === "string" ? payload.filters.reviewStatus : "all",
    dateFrom: typeof payload.filters?.dateFrom === "string" ? payload.filters.dateFrom : undefined,
    dateTo: typeof payload.filters?.dateTo === "string" ? payload.filters.dateTo : undefined,
    sortBy: payload.sortBy === "timestamp" || payload.sortBy === "finalConfidence" || payload.sortBy === "errorScore"
      ? payload.sortBy
      : "errorScore",
    sortDirection: payload.sortDirection === "asc" || payload.sortDirection === "desc"
      ? payload.sortDirection
      : "desc",
  });

  const page = typeof payload.page === "number" ? Math.max(1, Math.round(payload.page)) : 1;
  const pageSize = typeof payload.pageSize === "number" ? Math.max(1, Math.min(100, Math.round(payload.pageSize))) : 20;
  const start = (page - 1) * pageSize;

  return success("Loaded correction records.", {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
  });
});

export const correctionsReview = onCall(async (request) => {
  assertAdmin(request.auth);

  const payload = request.data as {
    action?: unknown;
    recordIds?: unknown;
    modifiedMetadata?: unknown;
  };

  const action = payload.action === "accept" || payload.action === "reject" || payload.action === "modify"
    ? payload.action
    : null;
  if (!action) {
    throw new HttpsError("invalid-argument", "Invalid review action.");
  }

  const recordIds = Array.isArray(payload.recordIds)
    ? payload.recordIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  if (!recordIds.length) {
    throw new HttpsError("invalid-argument", "At least one record ID is required.");
  }

  const batch = firestore.batch();
  let updated = 0;

  for (const recordId of recordIds) {
    const querySnapshot = await firestore.collectionGroup("items").where("id", "==", recordId).limit(1).get();
    if (querySnapshot.empty) {
      continue;
    }

    const doc = querySnapshot.docs[0];
    const data = doc.data() as Record<string, unknown>;
    const before = sanitizeMetadataCorrectionRecords([data])[0];
    if (!before) {
      continue;
    }

    const nextPayload: Record<string, unknown> = {
      reviewedByAdmin: request.auth?.uid ?? "unknown",
      reviewedAt: new Date().toISOString(),
      reviewStatus: action === "reject" ? "rejected" : "accepted",
    };

    if (action === "modify" && payload.modifiedMetadata && typeof payload.modifiedMetadata === "object") {
      const patched = {
        ...before.finalMetadata,
        ...(payload.modifiedMetadata as Record<string, unknown>),
      };
      const sanitizedPatched = sanitizeMetadataResult(patched, before.finalMetadata.source);
      nextPayload.finalMetadata = sanitizedPatched;
      nextPayload.finalConfidence = sanitizedPatched.confidence;
      nextPayload.errorScore = Math.abs((before.originalVisionOutput?.confidence ?? sanitizedPatched.confidence) - sanitizedPatched.confidence);
      nextPayload.flagged = false;
      nextPayload.reasonFlagged = admin.firestore.FieldValue.delete();
    }

    batch.set(doc.ref, nextPayload, { merge: true });
    updated += 1;

    await appendMetadataCorrectionAuditLog({
      actorId: request.auth?.uid ?? "unknown",
      action,
      targetIds: [recordId],
      before,
      after: { ...before, ...nextPayload },
    });
  }

  await batch.commit();

  return success("Applied correction review action.", { updated });
});

export const correctionsRules = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to fetch metadata correction rules.");
  }

  const snapshot = await firestore.doc(METADATA_CORRECTION_RULES_DOC_PATH).get();
  const rules = sanitizeMetadataCorrectionRules(snapshot.data());

  return success("Loaded metadata correction rules.", rules);
});

export const correctionsRulesUpdate = onCall(async (request) => {
  assertAdmin(request.auth);

  const payload = request.data as { rules?: unknown };
  const rules = sanitizeMetadataCorrectionRules(payload.rules);
  const next = {
    ...rules,
    updatedAt: new Date().toISOString(),
    updatedBy: request.auth?.uid ?? "unknown",
  };

  await firestore.doc(METADATA_CORRECTION_RULES_DOC_PATH).set(next, { merge: true });

  await appendMetadataCorrectionAuditLog({
    actorId: request.auth?.uid ?? "unknown",
    action: "rules-update",
    targetIds: [METADATA_CORRECTION_RULES_DOC_PATH],
    after: next,
  });

  return success("Updated metadata correction rules.", next);
});

// Compatibility aliases for previous callable names.
export const submitMetadataCorrections = correctionsUpload;
export const getMetadataCorrectionRules = correctionsRules;

// ---------------------------------------------------------------------------
// AI Document Content Extraction
// ---------------------------------------------------------------------------

function sanitizeExtractionContext(value: unknown): DocumentExtractionContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const context = value as Record<string, unknown>;
  const result: DocumentExtractionContext = {};

  if (typeof context.textbookTitle === "string") {
    result.textbookTitle = context.textbookTitle.trim();
  }
  if (typeof context.textbookSubject === "string") {
    result.textbookSubject = context.textbookSubject.trim();
  }
  if (typeof context.gradeLevel === "string") {
    result.gradeLevel = context.gradeLevel.trim();
  }
  if (typeof context.chapterTitle === "string") {
    result.chapterTitle = context.chapterTitle.trim();
  }
  if (typeof context.sectionTitle === "string") {
    result.sectionTitle = context.sectionTitle.trim();
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function uniqueTrimmedStrings(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

function normalizeComparisonKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildBlockedExtraction(quality: ExtractionQualityReport): ExtractedDocumentData {
  const empty = createEmptyExtractionData();
  return {
    ...empty,
    quality,
  };
}

function normalizeTieredText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resemblesProtectedTestContent(value: string): boolean {
  const text = value.toLowerCase();
  const patterns = [
    /answer\s+key/,
    /official\s+test/,
    /released\s+exam/,
    /practice\s+exam\s+copy/,
    /sat|act|ap\s+exam|state\s+test/,
    /question\s+\d+\s+from\s+test/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function forceSemanticRewrite(item: TieredQuestionItem): TieredQuestionItem {
  if (item.difficultyLevel === 2) {
    return {
      ...item,
      question: `In context, which choice best explains ${item.question}?`,
      correctAnswer: `A rephrased explanation of: ${item.correctAnswer}`,
    };
  }

  return {
    ...item,
    question: `Which option is NOT consistent with the concept of ${item.question}?`,
    correctAnswer: `The most defensible answer remains: ${item.correctAnswer}`,
  };
}

function buildFallbackDistractors(answer: string, chapterTerms: string[]): string[] {
  const normalizedAnswer = normalizeTieredText(answer);
  const fromChapter = chapterTerms
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && normalizeTieredText(term) !== normalizedAnswer)
    .slice(0, 5);

  if (fromChapter.length >= 3) {
    return fromChapter.slice(0, 3);
  }

  const seedWord = answer.split(/\s+/).find(Boolean) ?? "idea";
  return [
    ...fromChapter,
    `A common misconception about ${seedWord}`,
    `A partially correct statement about ${seedWord}`,
    `A one-word-off definition of ${seedWord}`,
  ].slice(0, 3);
}

function inferGradeLevel(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.match(/\d+/);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(1, Math.min(16, parsed));
}

function sanitizeTieredGenerationContext(value: unknown): TieredVariationGenerationContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const sanitized: TieredVariationGenerationContext = {};

  if (typeof source.textbookTitle === "string") {
    sanitized.textbookTitle = source.textbookTitle.trim();
  }

  if (typeof source.textbookSubject === "string") {
    sanitized.textbookSubject = source.textbookSubject.trim();
  }

  const numericGrade = typeof source.gradeLevel === "number" && Number.isFinite(source.gradeLevel)
    ? source.gradeLevel
    : undefined;
  const normalizedGrade = numericGrade ? Math.max(1, Math.min(16, Math.round(numericGrade))) : undefined;
  sanitized.gradeLevel = normalizedGrade;

  if (typeof source.level2TargetReadingGrade === "number" && Number.isFinite(source.level2TargetReadingGrade)) {
    sanitized.level2TargetReadingGrade = Math.max(1, Math.min(16, Math.round(source.level2TargetReadingGrade)));
  }

  if (typeof source.level3TargetReadingGrade === "number" && Number.isFinite(source.level3TargetReadingGrade)) {
    sanitized.level3TargetReadingGrade = Math.max(1, Math.min(16, Math.round(source.level3TargetReadingGrade)));
  }

  return Object.values(sanitized).some((entry) => entry !== undefined) ? sanitized : undefined;
}

function buildFallbackTieredItems(
  seedItems: TieredQuestionSeedItem[],
  chapterTerms: string[],
  generationContext?: TieredVariationGenerationContext
): TieredQuestionItem[] {
  const subjectHint = generationContext?.textbookSubject?.trim();
  const level2ReadingGrade = generationContext?.level2TargetReadingGrade;
  const level3ReadingGrade = generationContext?.level3TargetReadingGrade;

  const level1 = seedItems.map((item) => ({
    id: `${item.id}:l1`,
    baseItemId: item.id,
    contentType: item.contentType,
    question: item.question,
    correctAnswer: item.correctAnswer,
    distractors: buildFallbackDistractors(item.correctAnswer, chapterTerms),
    difficultyLevel: 1 as DifficultyLevel,
    isOriginal: true,
    variationOf: null,
    sourceMetadata: item.sourceMetadata,
  }));

  const level2 = level1.flatMap((item) => [1, 2].map((idx) => ({
    ...item,
    id: `${item.baseItemId}:l2:${idx}`,
    difficultyLevel: 2 as DifficultyLevel,
    isOriginal: false,
    variationOf: `${item.baseItemId}:l1`,
    question: `Which restatement best matches ${item.question}${subjectHint ? ` in ${subjectHint}` : ""}?`,
    correctAnswer: level2ReadingGrade
      ? `A reworded explanation of ${item.correctAnswer} written at about grade ${level2ReadingGrade} reading level.`
      : `A reworded explanation of ${item.correctAnswer}.`,
  })));

  const level3 = level1.flatMap((item) => [1, 2].map((idx) => ({
    ...item,
    id: `${item.baseItemId}:l3:${idx}`,
    difficultyLevel: 3 as DifficultyLevel,
    isOriginal: false,
    variationOf: `${item.baseItemId}:l1`,
    question: `Which option is NOT an accurate application of ${item.question}${subjectHint ? ` in ${subjectHint}` : ""}?`,
    correctAnswer: level3ReadingGrade
      ? `The strongest reasoning-based response aligned with ${item.correctAnswer}, written around grade ${level3ReadingGrade} reading level.`
      : `The strongest reasoning-based response aligns with ${item.correctAnswer}`,
  })));

  return [...level1, ...level2, ...level3];
}

function isTieredQuestionItem(value: unknown): value is TieredQuestionItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.baseItemId === "string" &&
    (item.contentType === "vocab" || item.contentType === "concept") &&
    typeof item.question === "string" &&
    typeof item.correctAnswer === "string" &&
    Array.isArray(item.distractors) &&
    (item.difficultyLevel === 1 || item.difficultyLevel === 2 || item.difficultyLevel === 3) &&
    typeof item.isOriginal === "boolean" &&
    (typeof item.variationOf === "string" || item.variationOf === null) &&
    typeof item.sourceMetadata === "object" &&
    item.sourceMetadata !== null
  );
}

/**
 * Extract structured educational content from a document using AI.
 *
 * Expects either:
 *   - { fileName, mimeType, text }   â€” plain-text content already extracted by the client
 *   - { fileName, mimeType, base64 } â€” Base64-encoded PDF or DOCX for server-side extraction
 *
 * Reads OPENAI_API_KEY from Firebase Functions secrets (set via `firebase functions:secrets:set OPENAI_API_KEY`).
 * Falls back to an empty extraction result rather than throwing when the key is not configured,
 * so the UI can still display the review screen with a prompt to configure the key.
 */
export const extractDocumentContent = onCall({ secrets: [openAiKeySecret] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to use document extraction.");
  }

  const data = request.data as {
    fileName?: unknown;
    mimeType?: unknown;
    text?: unknown;
    base64?: unknown;
    context?: unknown;
  };

  const fileName = typeof data.fileName === "string" ? data.fileName : "document";
  const mimeType = typeof data.mimeType === "string" ? data.mimeType : "text/plain";
  const rawText = typeof data.text === "string" ? data.text : null;
  const base64Data = typeof data.base64 === "string" ? data.base64 : null;
  const context = sanitizeExtractionContext(data.context);

  if (!rawText && !base64Data) {
    throw new HttpsError("invalid-argument", "Either text or base64 document content is required.");
  }

  const documentText = await extractReadableDocumentText({
    fileName,
    mimeType,
    rawText,
    base64Data,
  });

  if (!documentText.trim()) {
    throw new HttpsError("invalid-argument", "Could not extract readable text from the document.");
  }

  // Truncate to a safe context size (approx 12 000 tokens @ ~4 chars/token)
  const MAX_CHARS = 48_000;
  const truncated = documentText.length > MAX_CHARS
    ? documentText.slice(0, MAX_CHARS) + "\n[... content truncated ...]"
    : documentText;

  const heuristicQuality = analyzeDocumentQuality({
    text: truncated,
    fileName,
    mimeType,
    context,
  });

  if (!heuristicQuality.accepted) {
    return success("Document blocked for review.", buildBlockedExtraction(heuristicQuality));
  }

  const openaiKey = getOpenAiApiKey();
  if (!openaiKey) {
    const quality = mergeQualityReports(heuristicQuality, {
      accepted: false,
      documentType: heuristicQuality.documentType,
      detectedLanguage: heuristicQuality.detectedLanguage,
      questionAnswerLayouts: heuristicQuality.questionAnswerLayouts,
      issues: [{
        code: "extraction_unavailable",
        severity: "error",
        message: "AI extraction is unavailable because OPENAI_API_KEY is not configured.",
      }],
    });
    return success(
      `OpenAI key not configured. Set it with: firebase functions:secrets:set OPENAI_API_KEY`,
      buildBlockedExtraction(quality)
    );
  }

  const { systemPrompt, userPrompt } = buildExtractionPrompts({
    fileName,
    truncatedText: truncated,
    context,
    quality: heuristicQuality,
  });

  let extracted: ExtractedDocumentData = createEmptyExtractionData();

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1500,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new HttpsError("internal", `OpenAI API error: ${response.status} ${response.statusText}`);
    }

    void recordOpenAiRateLimitSnapshotBestEffort("gpt-4o-mini", response.headers);

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    const content = json.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip potential markdown code fences
    const cleaned = content.replace(/^```[a-z]*\n?|```$/gm, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const aiQuality = typeof parsed.quality === "object" && parsed.quality !== null
      ? parsed.quality as Partial<ExtractionQualityReport>
      : undefined;
    const mergedQuality = mergeQualityReports(heuristicQuality, aiQuality);

    const vocabWithDefinitions = Array.isArray(parsed.vocabWithDefinitions)
      ? (parsed.vocabWithDefinitions as Array<{ word?: unknown; definition?: unknown }>)
          .filter((entry) => typeof entry.word === "string" && entry.word.trim().length > 0)
          .map((entry) => ({
            word: (entry.word as string).trim(),
            definition: typeof entry.definition === "string" ? entry.definition.trim() || undefined : undefined,
          }))
      : [];

    const conceptsWithExplanations = Array.isArray(parsed.conceptsWithExplanations)
      ? (parsed.conceptsWithExplanations as Array<{ name?: unknown; explanation?: unknown }>)
          .filter((entry) => typeof entry.name === "string" && entry.name.trim().length > 0)
          .map((entry) => ({
            name: (entry.name as string).trim(),
            explanation: typeof entry.explanation === "string" ? entry.explanation.trim() || undefined : undefined,
          }))
      : [];

    const inferredChapterTitle = typeof parsed.inferredChapterTitle === "string"
      ? parsed.inferredChapterTitle.trim() || undefined
      : undefined;

    const inferredSectionTitle = typeof parsed.inferredSectionTitle === "string"
      ? parsed.inferredSectionTitle.trim() || undefined
      : undefined;

    const sectionTitleMismatch =
      context?.sectionTitle &&
      inferredSectionTitle &&
      normalizeComparisonKey(context.sectionTitle) !== normalizeComparisonKey(inferredSectionTitle);

    const qualityWithSectionCheck = sectionTitleMismatch
      ? {
          ...mergedQuality,
          issues: [
            ...mergedQuality.issues,
            {
              code: "subject_mismatch" as const,
              severity: "warning" as const,
              message: `Inferred section title "${inferredSectionTitle}" may not match selected section "${context?.sectionTitle}".`,
            },
          ],
        }
      : mergedQuality;

    extracted = {
      vocab: qualityWithSectionCheck.accepted
        ? (vocabWithDefinitions.length > 0
            ? uniqueTrimmedStrings(vocabWithDefinitions.map((entry) => entry.word))
            : uniqueTrimmedStrings(parsed.vocab))
        : [],
      concepts: qualityWithSectionCheck.accepted
        ? (conceptsWithExplanations.length > 0
            ? uniqueTrimmedStrings(conceptsWithExplanations.map((entry) => entry.name))
            : uniqueTrimmedStrings(parsed.concepts))
        : [],
      equations: qualityWithSectionCheck.accepted ? uniqueTrimmedStrings(parsed.equations) : [],
      namesAndDates: Array.isArray(parsed.namesAndDates)
        ? (parsed.namesAndDates as Array<{ name?: unknown; date?: unknown }>)
            .filter((entry) => typeof entry.name === "string")
            .map((entry) => ({ name: (entry.name as string).trim(), date: typeof entry.date === "string" ? entry.date.trim() || undefined : undefined }))
            .filter((entry) => qualityWithSectionCheck.accepted && entry.name.length > 0)
        : [],
      keyIdeas: qualityWithSectionCheck.accepted ? uniqueTrimmedStrings(parsed.keyIdeas) : [],
      vocabWithDefinitions: qualityWithSectionCheck.accepted ? vocabWithDefinitions : [],
      conceptsWithExplanations: qualityWithSectionCheck.accepted ? conceptsWithExplanations : [],
      inferredChapterTitle,
      inferredSectionTitle,
      quality: {
        ...qualityWithSectionCheck,
        accepted: !qualityWithSectionCheck.issues.some((issue) => issue.severity === "error"),
      },
    };

    void recordAiUsageBestEffort(request.auth.uid, {
      kind: "document_content",
      provider: "openai",
      requestCount: 1,
      tokenCount: typeof json.usage?.total_tokens === "number" ? Math.max(0, Math.floor(json.usage.total_tokens)) : 0,
      executionCount: 1,
    });
  } catch {
    void recordAiUsageBestEffort(request.auth.uid, {
      kind: "document_content",
      provider: "openai",
      requestCount: 1,
      failureCount: 1,
    });
    throw new HttpsError("internal", "AI returned malformed JSON. Please try again.");
  }

  return success(
    extracted.quality.issues.length > 0 ? "Extraction completed with review notes." : "Extraction complete.",
    extracted
  );
});

export const generateTieredQuestionVariations = onCall({ secrets: [openAiKeySecret] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to generate tiered question variations.");
  }

  const payload = request.data as {
    items?: unknown;
    chapterTerms?: unknown;
    generationContext?: unknown;
  };

  const seedItems = Array.isArray(payload.items)
    ? payload.items.filter((item): item is TieredQuestionSeedItem => {
        if (!item || typeof item !== "object") {
          return false;
        }

        const candidate = item as Record<string, unknown>;
        return (
          typeof candidate.id === "string" &&
          (candidate.contentType === "vocab" || candidate.contentType === "concept") &&
          typeof candidate.question === "string" &&
          typeof candidate.correctAnswer === "string" &&
          typeof candidate.sourceMetadata === "object" &&
          candidate.sourceMetadata !== null
        );
      })
    : [];

  if (seedItems.length === 0) {
    throw new HttpsError("invalid-argument", "At least one seed item is required.");
  }

  const derivedGradeFromSeeds = inferGradeLevel(
    seedItems.find((item) => typeof item.sourceMetadata?.educationalContext?.gradeLevel === "number")
      ?.sourceMetadata?.educationalContext?.gradeLevel?.toString()
  );
  const providedGenerationContext = sanitizeTieredGenerationContext(payload.generationContext);
  const gradeLevel = providedGenerationContext?.gradeLevel ?? derivedGradeFromSeeds;
  const generationContext: TieredVariationGenerationContext = {
    textbookTitle: providedGenerationContext?.textbookTitle
      ?? seedItems.find((item) => item.sourceMetadata?.educationalContext?.textbookTitle)
        ?.sourceMetadata?.educationalContext?.textbookTitle,
    textbookSubject: providedGenerationContext?.textbookSubject
      ?? seedItems.find((item) => item.sourceMetadata?.educationalContext?.textbookSubject)
        ?.sourceMetadata?.educationalContext?.textbookSubject,
    gradeLevel,
    level2TargetReadingGrade: providedGenerationContext?.level2TargetReadingGrade
      ?? (gradeLevel ? Math.min(16, gradeLevel + 1) : undefined),
    level3TargetReadingGrade: providedGenerationContext?.level3TargetReadingGrade
      ?? (gradeLevel ? Math.min(16, gradeLevel + 2) : undefined),
  };

  const chapterTerms = uniqueTrimmedStrings(payload.chapterTerms);
  const fallbackItems = buildFallbackTieredItems(seedItems, chapterTerms, generationContext);

  const openaiKey = getOpenAiApiKey();
  if (!openaiKey) {
    return success("Tiered variations generated with local fallback.", { items: fallbackItems });
  }

  const systemPrompt = [
    "You are an instructional quiz variation generator.",
    "Return ONLY valid JSON with shape: { \"items\": TieredQuestionItem[] }.",
    "Every seed item must produce:",
    "- Level 1 item: exact question text + exact correct answer + 3-5 AI distractors.",
    "- Level 2 items: 2-3 moderate practice variations with reworded stems/definitions.",
    "- Level 3 items: 2-3 high-difficulty variations (NOT/inverted/scenario/reasoning).",
    "For Level 1 distractors: similar length, similar reading level, plausible, include misconceptions, one-word-off when fitting, and chapter-term-based distractors.",
    "Respect classroom context when available:",
    "- Use textbook subject and textbook title to keep terms domain-appropriate.",
    "- Use provided grade-level targets to control reading complexity.",
    "- Level 2 should be roughly +1 reading level from base grade.",
    "- Level 3 should be roughly +2 reading levels from base grade.",
    "Do not copy or reference real test content.",
    "For Levels 2 and 3 always rewrite enough to avoid verbatim duplication while preserving meaning.",
    "Set `variationOf` to `<seed-id>:l1` for all Level 2 and Level 3 items.",
    "Set `isOriginal` true only for Level 1.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    seedItems,
    chapterTerms,
    generationContext,
    schema: {
      items: [
        {
          id: "string",
          baseItemId: "string",
          contentType: "vocab|concept",
          question: "string",
          correctAnswer: "string",
          distractors: ["string", "string", "string"],
          difficultyLevel: 1,
          isOriginal: true,
          variationOf: null,
          sourceMetadata: {
            sourceType: "string",
            originalFilename: "string",
            variationAllowed: true,
            inferredLocation: { chapter: 1, section: 1 },
          },
        },
      ],
    },
  });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2200,
        temperature: 0.45,
      }),
    });

    if (!response.ok) {
      return success("Tiered variations generated with fallback after AI error.", { items: fallbackItems });
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.[0]?.message?.content?.trim() ?? "";
    const cleaned = content.replace(/^```[a-z]*\n?|```$/gm, "").trim();
    const parsed = JSON.parse(cleaned) as { items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter(isTieredQuestionItem)
      : [];

    if (items.length === 0) {
      return success("Tiered variations generated with fallback due to malformed AI payload.", { items: fallbackItems });
    }

    const validated = items.map((item) => {
      const normalizedQuestion = normalizeTieredText(item.question);
      const normalizedAnswer = normalizeTieredText(item.correctAnswer);
      const resemblesTest = resemblesProtectedTestContent(item.question) || resemblesProtectedTestContent(item.correctAnswer);
      const needsRewrite =
        (item.difficultyLevel === 2 || item.difficultyLevel === 3) &&
        (resemblesTest || (item.isOriginal === false && normalizedQuestion === normalizeTieredText(item.baseItemId)));

      const withDistractors = {
        ...item,
        distractors: item.distractors
          .map((choice) => choice.trim())
          .filter((choice) => choice.length > 0 && normalizeTieredText(choice) !== normalizedAnswer)
          .slice(0, 5),
      };

      return needsRewrite ? forceSemanticRewrite(withDistractors) : withDistractors;
    });

    return success("Tiered variations generated.", { items: validated });
  } catch {
    return success("Tiered variations generated with fallback.", { items: fallbackItems });
  }
});

/**
 * Generate theme and visual redesign suggestions for imported slide decks.
 */
export const generatePresentationDesignSuggestions = onCall({ secrets: [openAiKeySecret] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to generate design suggestions.");
  }

  const payload = request.data as {
    presentationTitle?: unknown;
    topic?: unknown;
    slideTexts?: unknown;
  };

  const presentationTitle = typeof payload.presentationTitle === "string" ? payload.presentationTitle.trim() : "Untitled Presentation";
  const topic = typeof payload.topic === "string" ? payload.topic.trim() : "general education";
  const slideTexts = Array.isArray(payload.slideTexts)
    ? payload.slideTexts.filter((value): value is string => typeof value === "string").slice(0, 50)
    : [];

  const openaiKey = getOpenAiApiKey();
  if (!openaiKey) {
    return success("Fallback design suggestions generated.", {
      themeName: "Clear Professional",
      backgroundAssets: [
        "https://images.unsplash.com/photo-1557683316-973673baf926",
        "https://images.unsplash.com/photo-1526498460520-4c246339dccb",
      ],
      fontChoices: ["Calibri", "Trebuchet MS"],
      animationStyle: "fade-in",
      iconSuggestions: {
        vocabulary: "book-open",
        quiz: "lightbulb",
      },
      videoBackgroundSuggestions: ["https://cdn.pixabay.com/video/2021/08/15/85138-587284861_large.mp4"],
    });
  }

  const systemPrompt = [
    "You are an instructional design assistant for K-12 teachers.",
    "Return ONLY valid JSON without markdown.",
    "Suggest a modern and professional slide redesign package.",
    "Use this exact schema:",
    "{",
    '  "themeName": string,',
    '  "backgroundAssets": string[],',
    '  "fontChoices": string[],',
    '  "animationStyle": string,',
    '  "iconSuggestions": Record<string, string>,',
    '  "videoBackgroundSuggestions": string[]',
    "}",
    "Prefer high-resolution image and video URLs.",
    "Keep entries practical for classroom use.",
  ].join("\n");

  const userPrompt = [
    `Presentation title: ${presentationTitle}`,
    `Detected topic: ${topic}`,
    "Slide text samples:",
    ...slideTexts.map((text, index) => `${index + 1}. ${text}`),
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 900,
      temperature: 0.35,
    }),
  });

  if (!response.ok) {
    throw new HttpsError("internal", `OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = json.choices?.[0]?.message?.content?.trim() ?? "";
  try {
    const cleaned = content.replace(/^```[a-z]*\n?|```$/gm, "").trim();
    const parsed = JSON.parse(cleaned) as {
      themeName?: unknown;
      backgroundAssets?: unknown;
      fontChoices?: unknown;
      animationStyle?: unknown;
      iconSuggestions?: unknown;
      videoBackgroundSuggestions?: unknown;
    };

    return success("Design suggestions generated.", {
      themeName: typeof parsed.themeName === "string" ? parsed.themeName : "Modern Classroom",
      backgroundAssets: Array.isArray(parsed.backgroundAssets)
        ? parsed.backgroundAssets.filter((value): value is string => typeof value === "string")
        : [],
      fontChoices: Array.isArray(parsed.fontChoices)
        ? parsed.fontChoices.filter((value): value is string => typeof value === "string")
        : ["Calibri", "Segoe UI"],
      animationStyle: typeof parsed.animationStyle === "string" ? parsed.animationStyle : "fade-in",
      iconSuggestions: typeof parsed.iconSuggestions === "object" && parsed.iconSuggestions !== null
        ? parsed.iconSuggestions as Record<string, string>
        : {},
      videoBackgroundSuggestions: Array.isArray(parsed.videoBackgroundSuggestions)
        ? parsed.videoBackgroundSuggestions.filter((value): value is string => typeof value === "string")
        : [],
    });
  } catch {
    throw new HttpsError("internal", "AI returned malformed JSON for design suggestions.");
  }
});

interface ConvertPresentationApiPayload {
  fileName: string;
  base64: string;
}

interface ConvertPresentationApiResponse {
  fileName?: unknown;
  mimeType?: unknown;
  base64?: unknown;
}

function isValidBase64(value: string): boolean {
  if (!value || value.length < 20) {
    return false;
  }

  return /^[a-zA-Z0-9+/=]+$/.test(value);
}

async function callConversionEndpoint(input: {
  url: string;
  apiKey: string;
  payload: ConvertPresentationApiPayload;
}): Promise<ConvertPresentationApiResponse> {
  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(input.payload),
  });

  if (!response.ok) {
    throw new Error(`conversion_http_${response.status}`);
  }

  return await response.json() as ConvertPresentationApiResponse;
}

/**
 * Converts legacy .ppt files to .pptx through an external conversion API.
 *
 * Environment variables:
 * - CONVERSION_API_URL: primary conversion endpoint
 * - CONVERSION_API_KEY: bearer token for conversion service
 * - CONVERSION_FALLBACK_API_URL: optional backup endpoint
 */
export const convertPresentationFile = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to convert presentation files.");
  }

  const data = request.data as { fileName?: unknown; base64?: unknown };
  const fileName = typeof data.fileName === "string" ? data.fileName.trim() : "";
  const base64 = typeof data.base64 === "string" ? data.base64.trim() : "";

  if (!fileName.toLowerCase().endsWith(".ppt")) {
    throw new HttpsError("invalid-argument", "Only legacy .ppt files should be sent to conversion.");
  }

  if (!isValidBase64(base64)) {
    throw new HttpsError("invalid-argument", "Invalid or empty presentation payload.");
  }

  const apiKey = process.env.CONVERSION_API_KEY ?? "";
  const apiUrl = process.env.CONVERSION_API_URL ?? "";
  const fallbackUrl = process.env.CONVERSION_FALLBACK_API_URL ?? "";

  if (!apiKey || !apiUrl) {
    return {
      success: false,
      message: "Automatic .ppt conversion is not configured. Please convert to .pptx manually for now.",
      data: {
        fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        base64: "",
      },
    };
  }

  const endpoints = [apiUrl, fallbackUrl].filter(Boolean);
  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const converted = await callConversionEndpoint({
          url: endpoint,
          apiKey,
          payload: { fileName, base64 },
        });

        const convertedBase64 = typeof converted.base64 === "string" ? converted.base64.trim() : "";
        if (!isValidBase64(convertedBase64)) {
          throw new Error("conversion_response_invalid");
        }

        const convertedName = typeof converted.fileName === "string"
          ? converted.fileName
          : fileName.replace(/\.ppt$/i, ".pptx");

        return {
          success: true,
          message: "Presentation converted.",
          data: {
            fileName: convertedName,
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            base64: convertedBase64,
          },
        };
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw new HttpsError(
    "unavailable",
    `Automatic .ppt conversion failed after retries. Please retry or convert manually. (${String(lastError)})`
  );
});
