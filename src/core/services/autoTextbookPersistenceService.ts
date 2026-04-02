import type { RelatedIsbn } from "../models";
import { normalizeISBN } from "./isbnService";
import type { TocChapter } from "./textbookAutoExtractionService";

interface AutoCreateTextbookInput {
  sourceType: "auto" | "manual";
  originalLanguage?: string;
  translatedFields?: Record<string, { title?: string; subtitle?: string; chapters?: string[]; sections?: string[] }>;
  title: string;
  subtitle?: string;
  grade: string;
  gradeBand?: string;
  subject: string;
  edition: string;
  publicationYear: number;
  copyrightYear?: number;
  isbnRaw: string;
  isbnNormalized: string;
  additionalIsbns?: string[];
  relatedIsbns?: RelatedIsbn[];
  seriesName?: string;
  publisher?: string;
  publisherLocation?: string;
  mhid?: string;
  authors?: string[];
  tocExtractionConfidence?: number;
  imageModerationState?: "clear" | "pending_admin_review" | "blocked";
  imageModerationReason?: string;
  imageModerationConfidence?: number;
  cloudSyncBlockedReason?: "pending_admin_review" | "user_blocked" | "blocked_content";
  requiresAdminReview?: boolean;
  status?: "draft" | "submitted" | "approved" | "rejected";
  platformUrl?: string;
  coverDataUrl?: string;
}

export interface AutoPersistenceMetadata {
  sourceType?: "auto" | "manual";
  originalLanguage?: string;
  translatedFields?: Record<string, { title?: string; subtitle?: string; chapters?: string[]; sections?: string[] }>;
  title: string;
  subtitle?: string;
  grade: string;
  gradeBand?: string;
  subject: string;
  edition: string;
  publicationYear: number;
  copyrightYear?: number;
  isbnRaw: string;
  additionalIsbns?: string[];
  relatedIsbns?: RelatedIsbn[];
  seriesName?: string;
  publisher?: string;
  publisherLocation?: string;
  mhid?: string;
  authors?: string[];
  tocExtractionConfidence?: number;
  imageModerationState?: "clear" | "pending_admin_review" | "blocked";
  imageModerationReason?: string;
  imageModerationConfidence?: number;
  cloudSyncBlockedReason?: "pending_admin_review" | "user_blocked" | "blocked_content";
  requiresAdminReview?: boolean;
  status?: "draft" | "submitted" | "approved" | "rejected";
  platformUrl?: string;
}

export interface PersistAutoTextbookInput {
  metadata: AutoPersistenceMetadata;
  coverDataUrl: string;
  tocChapters: TocChapter[];
}

export interface PersistAutoTextbookDependencies {
  createTextbook: (input: AutoCreateTextbookInput) => Promise<string>;
  createChapter: (input: { sourceType?: "auto" | "manual"; textbookId: string; index: number; name: string; description?: string }) => Promise<string>;
  createSection: (input: { sourceType?: "auto" | "manual"; chapterId: string; index: number; title: string; notes?: string }) => Promise<string>;
}

function deriveChapterPageEnd(chapters: TocChapter[], chapterIndex: number): number | undefined {
  const chapter = chapters[chapterIndex];
  if (!chapter) {
    return undefined;
  }

  if (typeof chapter.pageEnd === "number" && Number.isFinite(chapter.pageEnd)) {
    return chapter.pageEnd;
  }

  if (typeof chapter.pageStart !== "number" || !Number.isFinite(chapter.pageStart)) {
    return undefined;
  }

  for (let index = chapterIndex + 1; index < chapters.length; index += 1) {
    const nextStart = chapters[index]?.pageStart;
    if (typeof nextStart === "number" && Number.isFinite(nextStart) && nextStart > chapter.pageStart) {
      return nextStart - 1;
    }
  }

  return undefined;
}

function buildChapterDescription(unitName: string | undefined, pageStart: number | undefined, pageEnd: number | undefined): string | undefined {
  const parts: string[] = [];
  if (unitName && unitName.trim()) {
    parts.push(unitName.trim());
  }

  if (typeof pageStart === "number" && Number.isFinite(pageStart)) {
    if (typeof pageEnd === "number" && Number.isFinite(pageEnd) && pageEnd >= pageStart) {
      parts.push(`Pages ${pageStart}-${pageEnd}`);
    } else {
      parts.push(`Starts on page ${pageStart}`);
    }
  }

  return parts.length > 0 ? parts.join(" | ") : undefined;
}

function buildSectionNotes(pageStart: number | undefined, pageEnd: number | undefined): string | undefined {
  if (typeof pageStart !== "number" || !Number.isFinite(pageStart)) {
    return undefined;
  }

  if (typeof pageEnd === "number" && Number.isFinite(pageEnd) && pageEnd >= pageStart) {
    return `Pages ${pageStart}-${pageEnd}`;
  }

  return `Starts on page ${pageStart}`;
}

export async function persistAutoTextbook(
  input: PersistAutoTextbookInput,
  deps: PersistAutoTextbookDependencies
): Promise<string> {
  const textbookId = await deps.createTextbook({
    sourceType: input.metadata.sourceType ?? "auto",
    originalLanguage: input.metadata.originalLanguage ?? "en",
    translatedFields: input.metadata.translatedFields,
    title: input.metadata.title.trim(),
    subtitle: input.metadata.subtitle,
    grade: input.metadata.grade.trim() || input.metadata.gradeBand?.trim() || "Unspecified",
    gradeBand: input.metadata.gradeBand,
    subject: input.metadata.subject.trim() || "Other",
    edition: input.metadata.edition.trim() || "Unknown",
    publicationYear: input.metadata.publicationYear,
    copyrightYear: input.metadata.copyrightYear,
    isbnRaw: input.metadata.isbnRaw.trim(),
    isbnNormalized: normalizeISBN(input.metadata.isbnRaw),
    additionalIsbns: input.metadata.additionalIsbns,
    relatedIsbns: input.metadata.relatedIsbns,
    seriesName: input.metadata.seriesName,
    publisher: input.metadata.publisher,
    publisherLocation: input.metadata.publisherLocation,
    mhid: input.metadata.mhid,
    authors: input.metadata.authors,
    tocExtractionConfidence: input.metadata.tocExtractionConfidence,
    imageModerationState: input.metadata.imageModerationState,
    imageModerationReason: input.metadata.imageModerationReason,
    imageModerationConfidence: input.metadata.imageModerationConfidence,
    cloudSyncBlockedReason: input.metadata.cloudSyncBlockedReason,
    requiresAdminReview: input.metadata.requiresAdminReview,
    status: input.metadata.status,
    platformUrl: input.metadata.platformUrl,
    coverDataUrl: input.coverDataUrl,
  });

  for (let chapterIndex = 0; chapterIndex < input.tocChapters.length; chapterIndex += 1) {
    const chapter = input.tocChapters[chapterIndex];
    const chapterOrder = Number.parseInt(chapter.chapterNumber, 10);
    const chapterPageEnd = deriveChapterPageEnd(input.tocChapters, chapterIndex);
    const createdChapterId = await deps.createChapter({
      sourceType: "auto",
      textbookId,
      index: Number.isInteger(chapterOrder) ? chapterOrder : chapterIndex + 1,
      name: chapter.title,
      description: buildChapterDescription(chapter.unitName, chapter.pageStart, chapterPageEnd),
    });

    for (let sectionIndex = 0; sectionIndex < chapter.sections.length; sectionIndex += 1) {
      const section = chapter.sections[sectionIndex];
      const sectionOrder = Number.parseInt(section.sectionNumber.split(".").at(-1) ?? "", 10);
      await deps.createSection({
        sourceType: "auto",
        chapterId: createdChapterId,
        index: Number.isInteger(sectionOrder) ? sectionOrder : sectionIndex + 1,
        title: section.title,
        notes: buildSectionNotes(section.pageStart, section.pageEnd),
      });
    }
  }

  return textbookId;
}
