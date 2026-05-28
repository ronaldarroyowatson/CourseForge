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
  source: "serviceusage" | "fallback";
  readLimitPerDay: number | null;
  writeLimitPerDay: number | null;
  message: string | null;
  details: SuperAdminGlobalQuotaDetails[];
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

export async function setUserSuperAdminStatus(uid: string, isSuperAdmin: boolean): Promise<string> {
  return callFunction<{ uid: string; isSuperAdmin: boolean }, string>("setUserSuperAdminStatus", { uid, isSuperAdmin });
}

export async function listAllSchoolsForSuperAdmin(): Promise<SchoolDirectoryRow[]> {
  return callFunction<Record<string, never>, SchoolDirectoryRow[]>("listAllSchoolsForSuperAdmin", {});
}
