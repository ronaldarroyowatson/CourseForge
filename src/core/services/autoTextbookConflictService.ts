import type { TocChapter } from "./textbookAutoExtractionService";

export type AutoConflictResolutionMode = "overwrite_auto" | "merge_dedupe";

export interface ExistingHierarchyChapter {
  id: string;
  index: number;
  name: string;
}

export interface ExistingHierarchySection {
  id: string;
  chapterId: string;
  index: number;
  title: string;
}

export interface ChapterUpsertInstruction {
  autoChapter: TocChapter;
  chapterIndex: number;
  existingChapterId?: string;
}

export interface SectionUpsertInstruction {
  chapterRef: {
    chapterIndex: number;
    existingChapterId?: string;
  };
  sectionIndex: number;
  sectionTitle: string;
  existingSectionId?: string;
}

export interface AutoConflictResolutionPlan {
  chapterUpserts: ChapterUpsertInstruction[];
  sectionUpserts: SectionUpsertInstruction[];
  chapterIdsToDelete: string[];
  sectionIdsToDelete: string[];
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findMatchingChapter(
  existingChapters: ExistingHierarchyChapter[],
  chapterIndex: number,
  chapterTitle: string
): ExistingHierarchyChapter | undefined {
  const byIndex = existingChapters.find((chapter) => chapter.index === chapterIndex + 1);
  if (byIndex) {
    return byIndex;
  }

  const chapterKey = normalizeKey(chapterTitle);
  if (!chapterKey) {
    return undefined;
  }

  return existingChapters.find((chapter) => normalizeKey(chapter.name) === chapterKey);
}

function findMatchingSection(
  existingSections: ExistingHierarchySection[],
  sectionIndex: number,
  sectionTitle: string
): ExistingHierarchySection | undefined {
  const byIndex = existingSections.find((section) => section.index === sectionIndex + 1);
  if (byIndex) {
    return byIndex;
  }

  const sectionKey = normalizeKey(sectionTitle);
  if (!sectionKey) {
    return undefined;
  }

  return existingSections.find((section) => normalizeKey(section.title) === sectionKey);
}

export function buildAutoConflictResolutionPlan(input: {
  mode: AutoConflictResolutionMode;
  autoTocChapters: TocChapter[];
  existingChapters: ExistingHierarchyChapter[];
  existingSectionsByChapterId: Record<string, ExistingHierarchySection[]>;
}): AutoConflictResolutionPlan {
  const chapterUpserts: ChapterUpsertInstruction[] = [];
  const sectionUpserts: SectionUpsertInstruction[] = [];

  for (let chapterIndex = 0; chapterIndex < input.autoTocChapters.length; chapterIndex += 1) {
    const autoChapter = input.autoTocChapters[chapterIndex];
    const matchedChapter = input.mode === "merge_dedupe"
      ? findMatchingChapter(input.existingChapters, chapterIndex, autoChapter.title)
      : undefined;

    chapterUpserts.push({
      autoChapter,
      chapterIndex,
      existingChapterId: matchedChapter?.id,
    });

    const existingSections = matchedChapter?.id
      ? input.existingSectionsByChapterId[matchedChapter.id] ?? []
      : [];

    for (let sectionIndex = 0; sectionIndex < autoChapter.sections.length; sectionIndex += 1) {
      const autoSection = autoChapter.sections[sectionIndex];
      const matchedSection = input.mode === "merge_dedupe"
        ? findMatchingSection(existingSections, sectionIndex, autoSection.title)
        : undefined;

      sectionUpserts.push({
        chapterRef: {
          chapterIndex,
          existingChapterId: matchedChapter?.id,
        },
        sectionIndex,
        sectionTitle: autoSection.title,
        existingSectionId: matchedSection?.id,
      });
    }
  }

  if (input.mode === "overwrite_auto") {
    const sectionIdsToDelete = Object.values(input.existingSectionsByChapterId)
      .flat()
      .map((section) => section.id);

    return {
      chapterUpserts,
      sectionUpserts,
      chapterIdsToDelete: input.existingChapters.map((chapter) => chapter.id),
      sectionIdsToDelete,
    };
  }

  return {
    chapterUpserts,
    sectionUpserts,
    chapterIdsToDelete: [],
    sectionIdsToDelete: [],
  };
}
