import { normalizeISBN } from "./isbnService";
import type { TocChapter } from "./textbookAutoExtractionService";

interface AutoCreateTextbookInput {
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
  seriesName?: string;
  publisher?: string;
  publisherLocation?: string;
  authors?: string[];
  tocExtractionConfidence?: number;
  imageModerationState?: "clear" | "pending_admin_review" | "blocked";
  imageModerationReason?: string;
  imageModerationConfidence?: number;
  cloudSyncBlockedReason?: "pending_admin_review" | "user_blocked" | "blocked_content";
  requiresAdminReview?: boolean;
  status?: "draft" | "submitted" | "approved" | "rejected";
  coverDataUrl?: string;
}

export interface AutoPersistenceMetadata {
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
  seriesName?: string;
  publisher?: string;
  publisherLocation?: string;
  authors?: string[];
  tocExtractionConfidence?: number;
  imageModerationState?: "clear" | "pending_admin_review" | "blocked";
  imageModerationReason?: string;
  imageModerationConfidence?: number;
  cloudSyncBlockedReason?: "pending_admin_review" | "user_blocked" | "blocked_content";
  requiresAdminReview?: boolean;
  status?: "draft" | "submitted" | "approved" | "rejected";
}

export interface PersistAutoTextbookInput {
  metadata: AutoPersistenceMetadata;
  coverDataUrl: string;
  tocChapters: TocChapter[];
}

export interface PersistAutoTextbookDependencies {
  createTextbook: (input: AutoCreateTextbookInput) => Promise<string>;
  createChapter: (input: { textbookId: string; index: number; name: string; description?: string }) => Promise<string>;
  createSection: (input: { chapterId: string; index: number; title: string; notes?: string }) => Promise<string>;
}

export async function persistAutoTextbook(
  input: PersistAutoTextbookInput,
  deps: PersistAutoTextbookDependencies
): Promise<string> {
  const textbookId = await deps.createTextbook({
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
    seriesName: input.metadata.seriesName,
    publisher: input.metadata.publisher,
    publisherLocation: input.metadata.publisherLocation,
    authors: input.metadata.authors,
    tocExtractionConfidence: input.metadata.tocExtractionConfidence,
    imageModerationState: input.metadata.imageModerationState,
    imageModerationReason: input.metadata.imageModerationReason,
    imageModerationConfidence: input.metadata.imageModerationConfidence,
    cloudSyncBlockedReason: input.metadata.cloudSyncBlockedReason,
    requiresAdminReview: input.metadata.requiresAdminReview,
    status: input.metadata.status,
    coverDataUrl: input.coverDataUrl,
  });

  for (let chapterIndex = 0; chapterIndex < input.tocChapters.length; chapterIndex += 1) {
    const chapter = input.tocChapters[chapterIndex];
    const chapterOrder = Number.parseInt(chapter.chapterNumber, 10);
    const createdChapterId = await deps.createChapter({
      textbookId,
      index: Number.isInteger(chapterOrder) ? chapterOrder : chapterIndex + 1,
      name: chapter.title,
      description: chapter.unitName,
    });

    for (let sectionIndex = 0; sectionIndex < chapter.sections.length; sectionIndex += 1) {
      const section = chapter.sections[sectionIndex];
      const sectionOrder = Number.parseInt(section.sectionNumber.split(".").at(-1) ?? "", 10);
      await deps.createSection({
        chapterId: createdChapterId,
        index: Number.isInteger(sectionOrder) ? sectionOrder : sectionIndex + 1,
        title: section.title,
      });
    }
  }

  return textbookId;
}
