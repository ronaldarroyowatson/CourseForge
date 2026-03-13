import { httpsCallable } from "firebase/functions";

import type { ContentStatus } from "../models/entities";
import { functionsClient } from "../../firebase/functions";
import { getAdminClaim, getCurrentUser } from "../../firebase/auth";
import { logSyncEvent } from "./syncService";

export interface AdminUserRecord {
  uid: string;
  displayName: string;
  email: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  isAdmin: boolean;
}

export interface PremiumUsageRecord {
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

export interface AdminPremiumUsageRow {
  uid: string;
  email: string;
  displayName: string;
  premiumTier: string;
  premiumUsage: PremiumUsageRecord;
}

export interface ModerationItem {
  docPath: string;
  collectionName: string;
  ownerId: string;
  ownerEmail: string | null;
  title: string;
  currentStatus: ContentStatus;
  lastModified: string | null;
  isArchived?: boolean;
}

export interface AdminContentRecord {
  docPath: string;
  id: string;
  collectionName: string;
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

interface CallableResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

async function callAdminFunction<TRequest, TResponse>(
  name: string,
  requestData: TRequest
): Promise<TResponse> {
  const currentUser = getCurrentUser();
  const isAdmin = await getAdminClaim();
  logSyncEvent("admin:call:start", `functions/${name}`, {
    requestData,
    uid: currentUser?.uid ?? null,
    isAdmin,
  });

  const callable = httpsCallable<TRequest, CallableResponse<TResponse>>(functionsClient, name);
  let result;

  try {
    result = await callable(requestData);
  } catch (error) {
    logSyncEvent("admin:call:error", `functions/${name}`, {
      requestData,
      uid: currentUser?.uid ?? null,
      isAdmin,
    }, error);
    throw error;
  }

  if (!result.data.success) {
    logSyncEvent("admin:call:failed", `functions/${name}`, result.data);
    throw new Error(result.data.message ?? `Admin function ${name} failed.`);
  }

  logSyncEvent("admin:call:success", `functions/${name}`, {
    uid: currentUser?.uid ?? null,
    isAdmin,
  });

  return result.data.data;
}

/**
 * Admin actions are intentionally routed through Cloud Functions rather than
 * direct Firestore writes in the browser, so custom claims and cross-user
 * mutations stay server-authoritative.
 */
export async function getAllUsers(): Promise<AdminUserRecord[]> {
  return callAdminFunction<Record<string, never>, AdminUserRecord[]>("listAdminUsers", {});
}

export async function setUserAdminStatus(uid: string, isAdmin: boolean): Promise<string> {
  return callAdminFunction<{ uid: string; isAdmin: boolean }, string>("setUserAdminStatus", { uid, isAdmin });
}

export async function getSubmittedContent(): Promise<ModerationItem[]> {
  return callAdminFunction<Record<string, never>, ModerationItem[]>("getModerationQueue", {});
}

export async function updateContentStatus(docPath: string, status: ContentStatus): Promise<string> {
  return callAdminFunction<{ docPath: string; status: ContentStatus }, string>("updateModerationStatus", {
    docPath,
    status,
  });
}

export async function adminArchiveContent(docPath: string, isArchived = true): Promise<string> {
  return callAdminFunction<{ docPath: string; isArchived: boolean }, string>("archiveAdminContent", {
    docPath,
    isArchived,
  });
}

export async function adminSoftDeleteContent(docPath: string, isDeleted = true): Promise<string> {
  return callAdminFunction<{ docPath: string; isDeleted: boolean }, string>("softDeleteAdminContent", {
    docPath,
    isDeleted,
  });
}

export async function getAllTextbooksAdmin(filters?: {
  isbn?: string;
  titleContains?: string;
  ownerEmail?: string;
  ownerUid?: string;
  collectionName?: "textbooks" | "chapters" | "sections" | "vocab" | "all";
}): Promise<AdminContentRecord[]> {
  return callAdminFunction<typeof filters, AdminContentRecord[]>("searchAdminContent", {
    isbn: filters?.isbn,
    titleContains: filters?.titleContains,
    ownerEmail: filters?.ownerEmail,
    ownerUid: filters?.ownerUid,
    collectionName: filters?.collectionName ?? "all",
  });
}

export async function adminUpdateContent(
  docPath: string,
  data: Record<string, unknown>
): Promise<string> {
  return callAdminFunction<{ docPath: string; data: Record<string, unknown> }, string>("updateAdminContent", {
    docPath,
    data,
  });
}

export async function getPremiumUsageReport(): Promise<AdminPremiumUsageRow[]> {
  return callAdminFunction<Record<string, never>, AdminPremiumUsageRow[]>("getPremiumUsageReport", {});
}

export async function managePremiumUser(
  uid: string,
  action: "freeze" | "unfreeze" | "resetDaily" | "resetWeekly" | "resetMonthly",
  freezePremium?: boolean
): Promise<AdminPremiumUsageRow> {
  return callAdminFunction<
    {
      uid: string;
      action: "freeze" | "unfreeze" | "resetDaily" | "resetWeekly" | "resetMonthly";
      freezePremium?: boolean;
    },
    AdminPremiumUsageRow
  >("managePremiumUser", { uid, action, freezePremium });
}

export async function getCurrentPremiumUsage(): Promise<PremiumUsageRecord> {
  return callAdminFunction<Record<string, never>, PremiumUsageRecord>("getCurrentPremiumUsage", {});
}
