/**
 * Moderation lifecycle for user-submitted content.
 * draft      – created locally, not submitted for review.
 * submitted  – owner submitted for admin approval.
 * approved   – visible to all teachers.
 * rejected   – only visible to the owner.
 */
export type ContentStatus = "draft" | "submitted" | "approved" | "rejected";

export interface Textbook {
  id: string;
  userId?: string;
  title: string;
  grade: string;
  subject: string;
  edition: string;
  publicationYear: number;
  isbnRaw: string;
  isbnNormalized: string;
  platformUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastModified: string;
  pendingSync: boolean;
  source: "local" | "cloud";
  isFavorite: boolean;
  isArchived: boolean;
  /** Moderation status. Defaults to "draft". */
  status?: ContentStatus;
  /** Soft-delete flag set by admins. Hidden from all non-admin views when true. */
  isDeleted?: boolean;
}

export interface Chapter {
  id: string;
  userId?: string;
  textbookId: string;
  index: number;
  name: string;
  description?: string;
  lastModified: string;
  pendingSync: boolean;
  source: "local" | "cloud";
  status?: ContentStatus;
  isDeleted?: boolean;
}

export interface Section {
  id: string;
  userId?: string;
  chapterId: string;
  index: number;
  title: string;
  notes?: string;
  lastModified: string;
  pendingSync: boolean;
  source: "local" | "cloud";
  status?: ContentStatus;
  isDeleted?: boolean;
}

export interface VocabTerm {
  id: string;
  userId?: string;
  sectionId: string;
  word: string;
  definition?: string;
  altDefinitions?: string[];
  lastModified: string;
  pendingSync: boolean;
  source: "local" | "cloud";
  status?: ContentStatus;
  isDeleted?: boolean;
}

export interface Equation {
  id: string;
  sectionId: string;
  name: string;
  latex: string;
  description?: string;
}

export interface Concept {
  id: string;
  sectionId: string;
  name: string;
  explanation?: string;
}

export interface KeyIdea {
  id: string;
  sectionId: string;
  text: string;
}

export interface CourseForgeEntityMap {
  textbooks: Textbook;
  chapters: Chapter;
  sections: Section;
  vocabTerms: VocabTerm;
  equations: Equation;
  concepts: Concept;
  keyIdeas: KeyIdea;
}
