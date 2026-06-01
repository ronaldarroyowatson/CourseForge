import { httpsCallable } from "firebase/functions";

import { functionsClient } from "../../firebase/functions";

interface CallableResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

async function callFunction<TRequest, TResponse>(name: string, payload: TRequest): Promise<TResponse> {
  const callable = httpsCallable<TRequest, CallableResponse<TResponse>>(functionsClient, name);
  const result = await callable(payload);
  if (!result.data.success) {
    throw new Error(result.data.message ?? `Function ${name} failed.`);
  }

  return result.data.data;
}

export interface SchoolDirectoryRow {
  schoolId: string;
  schoolName: string;
  districtName?: string | null;
  memberCount: number;
}

export interface SchoolUserRow {
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

export interface SchoolTextbookRow {
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

export interface SchoolInviteRow {
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

export interface SchoolDashboardData {
  schoolId: string;
  schoolName: string;
  districtName?: string | null;
  users: SchoolUserRow[];
  textbooks: SchoolTextbookRow[];
  invites: SchoolInviteRow[];
}

export interface PromotionRequestRow {
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

export interface SuperAdminDashboardStats {
  usersCount: number;
  schoolsCount: number;
  textbooksCount: number;
  pendingPromotionRequests: number;
  trackedReadsToday: number | null;
  trackedWritesToday: number | null;
  trackedAiRequestsToday: number | null;
  trackedAiBucketHitsToday: number | null;
}

export interface SuperAdminGlobalQuotaDetails {
  metric: string;
  displayName: string | null;
  unit: string | null;
  effectiveLimit: number | null;
  defaultLimit: number | null;
}

export interface SuperAdminGlobalQuota {
  projectId: string;
  fetchedAt: string;
  source: "serviceusage" | "monitoring" | "sync-usage" | "fallback";
  readLimitPerDay: number | null;
  writeLimitPerDay: number | null;
  deleteLimitPerDay: number | null;
  functionInvocationsLimitPerMonth: number | null;
  currentUsageSource: "monitoring" | "sync-usage" | "none";
  currentReadsToday?: number | null;
  currentWritesToday?: number | null;
  message: string | null;
  details: SuperAdminGlobalQuotaDetails[];
}

export interface SuperAdminAzureQuota {
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

export interface SuperAdminBackupConfig {
  primaryDb: "firestore" | "cosmos";
  mirrorEnabled: boolean;
  firestoreEnabled: boolean;
  cosmosEnabled: boolean;
  backupMode: "interval" | "manual";
  frequencyMinutes: number;
  lastBackupAt: string | null;
  nextBackupAt: string | null;
  updatedBy: string;
  updatedAt: string;
}

export interface SuperAdminBackupJob {
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

export interface OpenAiRateLimitSnapshot {
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

export interface AiSafetyPolicyRecord {
  defaultDailyRequestLimit: number;
  defaultDailyTokenLimit: number;
  defaultMonthlyBudgetUsd: number;
  openAiMonthlySpendUsd: number | null;
  githubCopilotTier?: "free" | "pro" | "business" | "enterprise";
  githubDailyRequestLimit?: number;
  githubDailyTokenLimit?: number;
  githubRequestsPerMinuteLimit?: number;
  githubTokensPerRequestInputLimit?: number;
  githubTokensPerRequestOutputLimit?: number;
  githubConcurrentRequestsLimit?: number;
  budgetAlertThresholdPct: number;
  budgetHardStopThresholdPct: number;
  updatedBy: string;
  updatedAt: string;
}

export interface CurrentAiSafetyStatus {
  usage: {
    aiRequestsToday: number;
    aiTokensToday: number;
    aiExecutionsToday: number;
    aiBucketHitsToday: number;
    aiFailuresToday: number;
    screenshotTextRequestsToday: number;
    imageMetadataRequestsToday: number;
    documentContentRequestsToday: number;
    providerRateLimitedToday: number;
    openAiRequestsToday?: number;
    openAiTokensToday?: number;
    githubRequestsToday?: number;
    githubTokensToday?: number;
    openAiRateLimitedToday?: number;
    githubRateLimitedToday?: number;
    lastResetDate: string;
  };
  effectiveLimits: {
    dailyRequestLimit: number;
    dailyTokenLimit: number;
    monthlyBudgetUsd: number;
    githubDailyRequestLimit?: number;
    githubDailyTokenLimit?: number;
    githubCopilotTier?: "free" | "pro" | "business" | "enterprise";
    githubRequestsPerMinuteLimit?: number;
    githubTokensPerRequestInputLimit?: number;
    githubTokensPerRequestOutputLimit?: number;
    githubConcurrentRequestsLimit?: number;
    budgetAlertThresholdPct: number;
    budgetHardStopThresholdPct: number;
    openAiMonthlySpendUsd: number | null;
  };
  dailyRequestUsagePercent: number;
  dailyTokenUsagePercent: number;
  githubDailyRequestUsagePercent?: number;
  githubDailyTokenUsagePercent?: number;
  monthlyBudgetUsagePercent: number | null;
  hasExceededDailyRequestLimit: boolean;
  hasExceededDailyTokenLimit: boolean;
  hasExceededGithubDailyRequestLimit?: boolean;
  hasExceededGithubDailyTokenLimit?: boolean;
  hasExceededMonthlyBudgetThreshold: boolean;
}

export interface SuperAdminAiProviderLimits {
  provider: "openai";
  capturedAt: string;
  policy: AiSafetyPolicyRecord;
  models: OpenAiRateLimitSnapshot[];
  github?: {
    tier: "free" | "pro" | "business" | "enterprise";
    requestsPerMinuteLimit: number;
    requestsPerDayLimit: number;
    tokensPerRequestInputLimit: number;
    tokensPerRequestOutputLimit: number;
    concurrentRequestsLimit: number;
  };
  aggregateToday: {
    aiRequestsToday: number;
    aiTokensToday: number;
    aiBucketHitsToday: number;
    aiFailuresToday: number;
    providerRateLimitedToday: number;
    openAiRequestsToday?: number;
    openAiTokensToday?: number;
    githubRequestsToday?: number;
    githubTokensToday?: number;
    openAiRateLimitedToday?: number;
    githubRateLimitedToday?: number;
  };
}

export async function listSchoolDirectory(query = ""): Promise<SchoolDirectoryRow[]> {
  return callFunction<{ query?: string }, SchoolDirectoryRow[]>("listSchoolDirectory", { query });
}

export async function setUserSchoolAffiliation(input: {
  schoolName: string;
  districtName?: string;
  schoolId?: string;
}): Promise<{ schoolId: string; schoolName: string; districtName?: string | null; assignedSchoolAdmin: boolean }> {
  return callFunction<typeof input, { schoolId: string; schoolName: string; districtName?: string | null; assignedSchoolAdmin: boolean }>(
    "setUserSchoolAffiliation",
    input
  );
}

export async function getSchoolAdminDashboard(schoolId?: string): Promise<SchoolDashboardData> {
  return callFunction<{ schoolId?: string }, SchoolDashboardData>("getSchoolAdminDashboard", { schoolId });
}

export async function inviteSchoolUser(email: string, schoolId?: string): Promise<SchoolInviteRow> {
  return callFunction<{ email: string; schoolId?: string }, SchoolInviteRow>("inviteSchoolUser", { email, schoolId });
}

export async function removeSchoolUser(uid: string, schoolId?: string): Promise<string> {
  return callFunction<{ uid: string; schoolId?: string }, string>("removeSchoolUser", { uid, schoolId });
}

export async function setSchoolTextbookDeletionState(input: {
  textbookId: string;
  isDeleted: boolean;
  schoolId?: string;
}): Promise<string> {
  return callFunction<typeof input, string>("setSchoolTextbookDeletionState", input);
}

export async function requestSchoolAdminPromotion(reason?: string): Promise<string> {
  return callFunction<{ reason?: string }, string>("requestSchoolAdminPromotion", { reason });
}

export async function getSuperAdminDashboardStats(): Promise<SuperAdminDashboardStats> {
  return callFunction<Record<string, never>, SuperAdminDashboardStats>("getSuperAdminDashboardStats", {});
}

export async function getSuperAdminGlobalQuota(): Promise<SuperAdminGlobalQuota> {
  return callFunction<Record<string, never>, SuperAdminGlobalQuota>("getSuperAdminGlobalQuota", {});
}

export async function getSuperAdminAzureQuota(): Promise<SuperAdminAzureQuota> {
  return callFunction<Record<string, never>, SuperAdminAzureQuota>("getSuperAdminAzureQuota", {});
}

export async function getSuperAdminBackupConfig(): Promise<SuperAdminBackupConfig> {
  return callFunction<Record<string, never>, SuperAdminBackupConfig>("getSuperAdminBackupConfig", {});
}

export async function setSuperAdminBackupConfig(input: Partial<SuperAdminBackupConfig>): Promise<SuperAdminBackupConfig> {
  return callFunction<Partial<SuperAdminBackupConfig>, SuperAdminBackupConfig>("setSuperAdminBackupConfig", input);
}

export async function runSuperAdminBackupNow(): Promise<SuperAdminBackupJob> {
  return callFunction<Record<string, never>, SuperAdminBackupJob>("runSuperAdminBackupNow", {});
}

export async function listSuperAdminBackupJobs(limit = 10): Promise<SuperAdminBackupJob[]> {
  return callFunction<{ limit: number }, SuperAdminBackupJob[]>("listSuperAdminBackupJobs", { limit });
}

export async function getSuperAdminAiProviderLimits(): Promise<SuperAdminAiProviderLimits> {
  return callFunction<Record<string, never>, SuperAdminAiProviderLimits>("getSuperAdminAiProviderLimits", {});
}

export async function setGlobalAiSafetyPolicy(input: Partial<AiSafetyPolicyRecord>): Promise<AiSafetyPolicyRecord> {
  return callFunction<Partial<AiSafetyPolicyRecord>, AiSafetyPolicyRecord>("setGlobalAiSafetyPolicy", input);
}

export async function setUserAiSafetyOverride(input: {
  uid: string;
  dailyRequestLimit?: number | null;
  dailyTokenLimit?: number | null;
  monthlyBudgetUsd?: number | null;
  githubDailyRequestLimit?: number | null;
  githubDailyTokenLimit?: number | null;
}): Promise<{ uid: string; override: { dailyRequestLimit: number | null; dailyTokenLimit: number | null; monthlyBudgetUsd: number | null; githubDailyRequestLimit?: number | null; githubDailyTokenLimit?: number | null; updatedBy: string; updatedAt: string } }> {
  return callFunction<typeof input, { uid: string; override: { dailyRequestLimit: number | null; dailyTokenLimit: number | null; monthlyBudgetUsd: number | null; githubDailyRequestLimit?: number | null; githubDailyTokenLimit?: number | null; updatedBy: string; updatedAt: string } }>("setUserAiSafetyOverride", input);
}

export async function getCurrentAiSafetyStatus(): Promise<CurrentAiSafetyStatus> {
  return callFunction<Record<string, never>, CurrentAiSafetyStatus>("getCurrentAiSafetyStatus", {});
}

export async function listSchoolAdminPromotionRequests(status: "pending" | "approved" | "rejected" | "all" = "pending"): Promise<PromotionRequestRow[]> {
  return callFunction<{ status: "pending" | "approved" | "rejected" | "all" }, PromotionRequestRow[]>("listSchoolAdminPromotionRequests", { status });
}

export async function resolveSchoolAdminPromotionRequest(input: {
  requestId: string;
  approve: boolean;
  notes?: string;
}): Promise<string> {
  return callFunction<typeof input, string>("resolveSchoolAdminPromotionRequest", input);
}

export async function setUserSuperAdminStatus(uid: string, isSuperAdmin: boolean, transferToUid?: string): Promise<string> {
  return callFunction<{ uid: string; isSuperAdmin: boolean; transferToUid?: string }, string>("setUserSuperAdminStatus", {
    uid,
    isSuperAdmin,
    transferToUid,
  });
}

export async function listAllSchoolsForSuperAdmin(): Promise<SchoolDirectoryRow[]> {
  return callFunction<Record<string, never>, SchoolDirectoryRow[]>("listAllSchoolsForSuperAdmin", {});
}
