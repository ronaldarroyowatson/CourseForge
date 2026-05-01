/**
 * Moderation lifecycle for user-submitted content.
 * draft      - created locally, not submitted for review.
 * submitted  - owner submitted for admin approval.
 * approved   - visible to all teachers.
 * rejected   - only visible to the owner.
 */
export type ContentStatus = "draft" | "submitted" | "approved" | "rejected";

/** Describes the role of a related ISBN (different editions, formats, etc.). */
export type RelatedIsbnType = "student" | "teacher" | "digital" | "workbook" | "assessment" | "other";

/** An additional ISBN associated with the same textbook in a different edition or format. */
export interface RelatedIsbn {
  isbn: string;
  type: RelatedIsbnType;
  note?: string;
}

export interface UserPreferences {
  language: string;
  accessibility: {
    colorBlindMode?: "protanopia" | "deuteranopia" | "tritanopia" | "none";
    dyslexiaMode?: boolean;
    dyscalculiaMode?: boolean;
    highContrastMode?: boolean;
    fontScale?: number;
    uiScale?: number;
  };
}

export interface TextbookTranslatedFields {
  title?: string;
  subtitle?: string;
  chapters?: string[];
  sections?: string[];
}

export interface TranslationHistoryEntry {
  timestamp: number;
  oldValue: string;
  newValue: string;
  updatedBy: string;
}

export interface TranslationMemoryEntry {
  id: string;
  termId: string;
  sourceText: string;
  translatedText: string;
  language: string;
  partOfSpeech?: string;
  contextTags?: string[];
  lastUpdated: number;
  updatedBy: "ai" | "teacher" | "admin";
  confidence: number;
  locked?: boolean;
  literalTranslation?: string;
  contextualTranslation?: string;
  academicTranslation?: string;
  history?: TranslationHistoryEntry[];
}

export interface TranslationReviewItem {
  id: string;
  termId: string;
  sourceText: string;
  translatedText: string;
  language: string;
  confidence: number;
  updatedBy: "ai" | "teacher" | "admin";
  contextTags: string[];
  lastUpdated: number;
  reason: "new-ai" | "low-confidence" | "recently-changed";
}

export interface GameTextEntry {
  id: string;
  gameId: string;
  key: string;
  defaultLanguage: string;
  texts: Record<string, string>;
  contextTags?: string[];
  lastUpdated: number;
  updatedBy: "ai" | "teacher" | "admin" | "system";
}

export interface GlossaryEntry {
  id: string;
  subject: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceTerm: string;
  preferredTranslation: string;
  notes?: string;
  usageRefs?: string[];
  createdAt: number;
  updatedAt: number;
  updatedBy: "teacher" | "admin" | "system";
}

export interface LanguagePack {
  language: string;
  uiTranslationsPath: string;
  glossaryPath: string;
  accessibilityFontFamily?: string;
  culturalLocalizationRules?: string[];
}

export interface Textbook {
  id: string;
  sourceType: "auto" | "manual";
  userId?: string;
  originalLanguage: string;
  translatedFields?: Record<string, TextbookTranslatedFields>;
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
  /** Additional related ISBNs (student, teacher, digital, etc.). */
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
  platformUrl?: string;
  /** Firebase Storage download URL for the cover image. */
  coverImageUrl?: string | null;
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
  /**
   * Tracks incomplete cloud upload state for admin diagnostics and smart batch retry.
   * "in_progress"  – a batch upload has started but not all entities are synced yet.
   * "complete"     – all entities for this textbook have been uploaded successfully.
   * "stalled"      – batch upload started but made no progress after repeated windows.
   * "invalid"      – one or more entity paths could not be resolved during upload.
   */
  uploadStatus?: "in_progress" | "complete" | "stalled" | "invalid";
  /** ISO timestamp when the first upload batch was initiated for this textbook. */
  uploadStartedAt?: string;
  /** ISO timestamp of the most recent upload batch attempt. */
  uploadLastBatchAt?: string;
  /** ISO timestamp when the stalled status was last set. */
  uploadStalledAt?: string;
  /** Human-readable reason for incomplete, stalled, or invalid upload state. */
  uploadIncompleteReason?: string;
}

export interface Chapter {
  id: string;
  sourceType: "auto" | "manual";
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
  sourceType: "auto" | "manual";
  userId?: string;
  textbookId?: string;
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

export type DifficultyLevel = 1 | 2 | 3;

export interface SourceMetadata {
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

export interface TieredQuestionMetadata {
  difficultyLevel?: DifficultyLevel;
  isOriginal?: boolean;
  variationOf?: string | null;
  questionStem?: string;
  correctAnswer?: string;
  distractors?: string[];
  sourceMetadata?: SourceMetadata;
}

export interface VocabTerm extends TieredQuestionMetadata {
  id: string;
  userId?: string;
  textbookId?: string;
  chapterId?: string;
  sectionId: string;
  word: string;
  definition?: string;
  languageTag?: string;
  altDefinitions?: string[];
  lastModified: string;
  pendingSync: boolean;
  source: "local" | "cloud";
  status?: ContentStatus;
  isDeleted?: boolean;
}

interface SectionContentEntity {
  id: string;
  userId?: string;
  textbookId?: string;
  chapterId?: string;
  sectionId: string;
  lastModified?: string;
  pendingSync?: boolean;
  source?: "local" | "cloud";
  status?: ContentStatus;
  isDeleted?: boolean;
}

export interface Equation extends SectionContentEntity {
  name: string;
  latex: string;
  description?: string;
}

export interface Concept extends SectionContentEntity, TieredQuestionMetadata {
  name: string;
  explanation?: string;
  languageTag?: string;
}

export interface KeyIdea extends SectionContentEntity {
  text: string;
}

export interface DocumentIngestFingerprint {
  id: string;
  sectionId: string;
  fileName: string;
  fileHash: string;
  extractedSignature: string;
  createdAt: string;
  updatedAt: string;
}

/** Classifies the educational purpose of a slide extracted from a PowerPoint file. */
export type SlideContentType = "title" | "vocab" | "content" | "diagram" | "quizQuestion" | "quizAnswer";

export interface PresentationSlide {
  id: string;
  index: number;
  type: SlideContentType;
  rawText: string[];
  extractedFormulas?: string[];
  extractedImages?: string[];
  notes?: string;
}

export interface DesignSuggestions {
  themeName: string;
  backgroundAssets: string[];
  fontChoices: string[];
  animationStyle: string;
  iconSuggestions?: Record<string, string>;
  videoBackgroundSuggestions?: string[];
}

export interface ExtractedVocabEntry {
  word: string;
  definition?: string;
}

export interface ExtractedConceptEntry {
  name: string;
  explanation?: string;
}

export interface ExtractedPresentation {
  id: string;
  userId?: string;
  textbookId?: string;
  chapterId?: string;
  sectionId?: string;
  sourceKey?: string;
  fileHash?: string;
  inferredChapterTitle?: string;
  inferredSectionTitle?: string;
  presentationTitle: string;
  fileName: string;
  slides: PresentationSlide[];
  extractedVocab?: ExtractedVocabEntry[];
  extractedConcepts?: ExtractedConceptEntry[];
  designSuggestions?: DesignSuggestions;
  createdAt: string;
  updatedAt: string;
  pendingSync: boolean;
  source: "local" | "cloud";
}

export interface CourseForgeEntityMap {
  textbooks: Textbook;
  chapters: Chapter;
  sections: Section;
  vocabTerms: VocabTerm;
  equations: Equation;
  concepts: Concept;
  keyIdeas: KeyIdea;
  translationMemory: TranslationMemoryEntry;
  gameText: GameTextEntry;
  glossaries: GlossaryEntry;
  ingestFingerprints: DocumentIngestFingerprint;
  extractedPresentations: ExtractedPresentation;
}
