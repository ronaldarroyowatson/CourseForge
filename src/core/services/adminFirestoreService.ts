import { httpsCallable } from "firebase/functions";

import type { ContentStatus } from "../models/entities";
import { functionsClient } from "../../firebase/functions";

export interface AdminUserRecord {
  uid: string;
  displayName: string;
  email: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  isAdmin: boolean;
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
  const callable = httpsCallable<TRequest, CallableResponse<TResponse>>(functionsClient, name);
  const result = await callable(requestData);

  if (!result.data.success) {
    throw new Error(result.data.message ?? `Admin function ${name} failed.`);
  }

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
  collectionName?: "textbooks" | "chapters" | "sections" | "vocabTerms" | "all";
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
