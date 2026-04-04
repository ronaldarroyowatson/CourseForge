import type { TocChapter, TocSection, TocUnit } from "../../../../core/services/textbookAutoExtractionService";

export type TocPreviewLevel = "unit" | "chapter" | "section" | "subsection";

export interface TocPreviewNodeModel {
  id: string;
  level: TocPreviewLevel;
  headingLabel?: string;
  numberValue: string;
  title: string;
  pageStart?: number;
  pageEnd?: number;
  pageRangeLabel: string;
  confidence: number;
  missingFields: string[];
  chapterIndex: number;
  sectionIndex?: number;
  unitIndex?: number;
  children: TocPreviewNodeModel[];
}

export interface TocPreviewBuildResult {
  nodes: TocPreviewNodeModel[];
  chapterCount: number;
  sectionCount: number;
  subsectionCount: number;
  missingCount: number;
}

function normalizePageStart(pageStart: number | undefined): number | undefined {
  return typeof pageStart === "number" && Number.isFinite(pageStart) && pageStart > 0
    ? pageStart
    : undefined;
}

function inferSiblingEnd(
  currentStart: number | undefined,
  nextStart: number | undefined,
  explicitEnd?: number
): number | undefined {
  if (typeof explicitEnd === "number" && Number.isFinite(explicitEnd) && explicitEnd > 0) {
    return explicitEnd;
  }

  if (
    typeof currentStart === "number"
    && Number.isFinite(currentStart)
    && typeof nextStart === "number"
    && Number.isFinite(nextStart)
    && nextStart > currentStart
  ) {
    return nextStart - 1;
  }

  return undefined;
}

function findNextChapterStart(chapters: TocChapter[], chapterIndex: number): number | undefined {
  for (let index = chapterIndex + 1; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    if (typeof chapter?.pageStart === "number" && Number.isFinite(chapter.pageStart) && chapter.pageStart > 0) {
      return chapter.pageStart;
    }

    const firstSectionStart = chapter?.sections
      ?.map((section) => section.pageStart)
      .find((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

    if (typeof firstSectionStart === "number") {
      return firstSectionStart;
    }
  }

  return undefined;
}

function toRangeLabel(pageStart?: number, pageEnd?: number): string {
  if (typeof pageStart !== "number") {
    return "p. ?";
  }

  if (typeof pageEnd !== "number") {
    return `p. ${pageStart}`;
  }

  if (pageEnd < pageStart) {
    return `p. ${pageStart}`;
  }

  return `pp. ${pageStart}-${pageEnd}`;
}

function scoreNodeConfidence(baseConfidence: number, hasNumber: boolean, hasTitle: boolean, hasPageStart: boolean): number {
  let score = Math.max(0, Math.min(1, baseConfidence || 0));

  if (!hasNumber) {
    score -= 0.18;
  }

  if (!hasTitle) {
    score -= 0.26;
  }

  if (!hasPageStart) {
    score -= 0.22;
  }

  return Math.max(0.08, Math.min(1, score));
}

function collectMissingFields(
  numberValue: string,
  title: string,
  pageStart: number | undefined,
  options: { requireNumber: boolean }
): string[] {
  const missing: string[] = [];
  if (options.requireNumber && !numberValue.trim()) {
    missing.push("number");
  }

  if (!title.trim()) {
    missing.push("title");
  }

  if (typeof pageStart !== "number") {
    missing.push("start page");
  }

  return missing;
}

function getSectionDepth(sectionNumber: string): number {
  const matches = sectionNumber.match(/\./g);
  return (matches?.length ?? 0) + 1;
}

function isSubsection(section: TocSection): boolean {
  return getSectionDepth(section.sectionNumber) >= 3;
}

function parentSectionPrefix(sectionNumber: string): string {
  const parts = sectionNumber.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return sectionNumber;
  }

  return parts.slice(0, 2).join(".");
}

function buildSectionNodes(chapters: TocChapter[], chapterIndex: number, sections: TocSection[], baseConfidence: number): TocPreviewNodeModel[] {
  const topLevelSections: TocPreviewNodeModel[] = [];
  const sectionIdByPrefix = new Map<string, string>();
  const sectionById = new Map<string, TocPreviewNodeModel>();

  sections.forEach((section, sectionIndex) => {
    const numberValue = section.sectionNumber ?? "";
    const title = section.title ?? "";
    const pageStart = normalizePageStart(section.pageStart);
    const nextStart = normalizePageStart(sections[sectionIndex + 1]?.pageStart);
    const nextChapterStart = !nextStart ? findNextChapterStart(chapters, chapterIndex) : undefined;
    const pageEnd = inferSiblingEnd(pageStart, nextStart ?? nextChapterStart, section.pageEnd);
    const missingFields = collectMissingFields(numberValue, title, pageStart, { requireNumber: false });
    const nodeConfidence = scoreNodeConfidence(baseConfidence, Boolean(numberValue.trim()), Boolean(title.trim()), typeof pageStart === "number");

    const node: TocPreviewNodeModel = {
      id: `chapter-${chapterIndex}-section-${sectionIndex}`,
      level: isSubsection(section) ? "subsection" : "section",
      numberValue,
      title,
      pageStart,
      pageEnd,
      pageRangeLabel: toRangeLabel(pageStart, pageEnd),
      confidence: nodeConfidence,
      missingFields,
      chapterIndex,
      sectionIndex,
      children: [],
    };

    if (node.level === "subsection") {
      const parentPrefix = parentSectionPrefix(numberValue);
      const parentId = sectionIdByPrefix.get(parentPrefix);
      if (parentId) {
        const parent = sectionById.get(parentId);
        if (parent) {
          parent.children.push(node);
          sectionById.set(node.id, node);
          return;
        }
      }

      const syntheticParentId = `chapter-${chapterIndex}-synthetic-${parentPrefix || sectionIndex}`;
      let syntheticParent = sectionById.get(syntheticParentId);
      if (!syntheticParent) {
        syntheticParent = {
          id: syntheticParentId,
          level: "section",
          numberValue: parentPrefix,
          title: "Section title missing",
          pageStart: undefined,
          pageEnd: undefined,
          pageRangeLabel: "p. ?",
          confidence: 0.22,
          missingFields: ["title", "start page"],
          chapterIndex,
          children: [],
        };
        topLevelSections.push(syntheticParent);
        sectionById.set(syntheticParentId, syntheticParent);
        sectionIdByPrefix.set(parentPrefix, syntheticParentId);
      }

      syntheticParent.children.push(node);
      sectionById.set(node.id, node);
      return;
    }

    topLevelSections.push(node);
    sectionById.set(node.id, node);
    if (numberValue.trim()) {
      sectionIdByPrefix.set(numberValue.trim(), node.id);
    }
  });

  return topLevelSections;
}

export function buildTocPreviewTree(chapters: TocChapter[], globalConfidence: number, units?: TocUnit[]): TocPreviewBuildResult {
  // If units are provided, build the tree with units as the top level
  if (units && units.length > 0) {
    return buildTocPreviewTreeWithUnits(units, chapters, globalConfidence);
  }

  // Otherwise, build the tree with chapters as the top level (legacy behavior)
  return buildTocPreviewTreeWithoutUnits(chapters, globalConfidence);
}

function buildTocPreviewTreeWithoutUnits(chapters: TocChapter[], globalConfidence: number): TocPreviewBuildResult {
  const nodes: TocPreviewNodeModel[] = chapters.map((chapter, chapterIndex) => {
    const numberValue = chapter.chapterNumber ?? "";
    const title = chapter.title ?? "";
    const pageStart = normalizePageStart(chapter.pageStart);
    const nextStart = normalizePageStart(chapters[chapterIndex + 1]?.pageStart);
    const pageEnd = inferSiblingEnd(pageStart, nextStart, chapter.pageEnd);
    const missingFields = collectMissingFields(numberValue, title, pageStart, { requireNumber: true });
    const confidence = scoreNodeConfidence(globalConfidence, Boolean(numberValue.trim()), Boolean(title.trim()), typeof pageStart === "number");

    return {
      id: `chapter-${chapterIndex}`,
      level: "chapter",
      headingLabel: chapter.chapterLabel ?? "Chapter",
      numberValue,
      title,
      pageStart,
      pageEnd,
      pageRangeLabel: toRangeLabel(pageStart, pageEnd),
      confidence,
      missingFields,
      chapterIndex,
      children: buildSectionNodes(chapters, chapterIndex, chapter.sections, globalConfidence),
    } satisfies TocPreviewNodeModel;
  });

  const sectionCount = nodes.reduce((sum, chapter) => sum + chapter.children.length, 0);
  const subsectionCount = nodes.reduce(
    (sum, chapter) => sum + chapter.children.reduce((childSum, section) => childSum + section.children.length, 0),
    0
  );

  const missingCount = nodes.reduce((sum, chapter) => {
    const chapterMissing = chapter.missingFields.length > 0 ? 1 : 0;
    const sectionMissing = chapter.children.reduce((sectionSum, section) => {
      const ownMissing = section.missingFields.length > 0 ? 1 : 0;
      const subsectionMissing = section.children.reduce((subSum, subsection) => subSum + (subsection.missingFields.length > 0 ? 1 : 0), 0);
      return sectionSum + ownMissing + subsectionMissing;
    }, 0);
    return sum + chapterMissing + sectionMissing;
  }, 0);

  return {
    nodes,
    chapterCount: nodes.length,
    sectionCount,
    subsectionCount,
    missingCount,
  };
}

function buildTocPreviewTreeWithUnits(units: TocUnit[], allChapters: TocChapter[], globalConfidence: number): TocPreviewBuildResult {
  const nodes: TocPreviewNodeModel[] = units.map((unit, unitIndex) => {
    const numberValue = unit.unitNumber ?? "";
    const title = unit.title ?? "";
    const pageStart = normalizePageStart(unit.pageStart);
    const nextStart = normalizePageStart(units[unitIndex + 1]?.pageStart);
    const pageEnd = inferSiblingEnd(pageStart, nextStart, unit.pageEnd);
    const missingFields = collectMissingFields(numberValue, title, pageStart, { requireNumber: true });
    const confidence = scoreNodeConfidence(globalConfidence, Boolean(numberValue.trim()), Boolean(title.trim()), typeof pageStart === "number");

    // Build chapter nodes for this unit
    const chapterNodes: TocPreviewNodeModel[] = unit.chapters.map((chapter, chapterIndexInUnit) => {
      // Find the index of this chapter in the overall chapters array
      const globalChapterIndex = allChapters.findIndex(
        (ch) => ch.chapterNumber === chapter.chapterNumber && ch.title === chapter.title
      );

      const chapterNumberValue = chapter.chapterNumber ?? "";
      const chapterTitle = chapter.title ?? "";
      const chapterPageStart = normalizePageStart(chapter.pageStart);

      // Get next chapter's start page (either next in unit or next in all chapters)
      let nextChapterStart: number | undefined;
      if (chapterIndexInUnit + 1 < unit.chapters.length) {
        const nextChapter = unit.chapters[chapterIndexInUnit + 1];
        nextChapterStart = normalizePageStart(nextChapter.pageStart);
      } else {
        // Look in the next unit or subsequent chapters
        nextChapterStart = undefined;
      }

      const chapterPageEnd = inferSiblingEnd(chapterPageStart, nextChapterStart, chapter.pageEnd);
      const chapterMissingFields = collectMissingFields(chapterNumberValue, chapterTitle, chapterPageStart, { requireNumber: true });
      const chapterConfidence = scoreNodeConfidence(globalConfidence, Boolean(chapterNumberValue.trim()), Boolean(chapterTitle.trim()), typeof chapterPageStart === "number");

      return {
        id: `unit-${unitIndex}-chapter-${chapterIndexInUnit}`,
        level: "chapter",
        headingLabel: chapter.chapterLabel ?? "Chapter",
        numberValue: chapterNumberValue,
        title: chapterTitle,
        pageStart: chapterPageStart,
        pageEnd: chapterPageEnd,
        pageRangeLabel: toRangeLabel(chapterPageStart, chapterPageEnd),
        confidence: chapterConfidence,
        missingFields: chapterMissingFields,
        chapterIndex: globalChapterIndex >= 0 ? globalChapterIndex : chapterIndexInUnit,
        children: buildSectionNodes(unit.chapters, chapterIndexInUnit, chapter.sections, globalConfidence),
      } satisfies TocPreviewNodeModel;
    });

    return {
      id: `unit-${unitIndex}`,
      level: "unit",
      headingLabel: "Unit",
      numberValue,
      title,
      pageStart,
      pageEnd,
      pageRangeLabel: toRangeLabel(pageStart, pageEnd),
      confidence,
      missingFields,
      chapterIndex: 0, // Not directly applicable for units, but required by interface
      unitIndex,
      children: chapterNodes,
    } satisfies TocPreviewNodeModel;
  });

  // Count chapters and sections
  let totalChapterCount = 0;
  let totalSectionCount = 0;
  let totalSubsectionCount = 0;

  for (const unitNode of nodes) {
    totalChapterCount += unitNode.children.length;
    for (const chapterNode of unitNode.children) {
      totalSectionCount += chapterNode.children.length;
      for (const sectionNode of chapterNode.children) {
        totalSubsectionCount += sectionNode.children.length;
      }
    }
  }

  const missingCount = nodes.reduce((sum, unitNode) => {
    const unitMissing = unitNode.missingFields.length > 0 ? 1 : 0;
    const chapterMissing = unitNode.children.reduce((chapterSum, chapter) => {
      const ownMissing = chapter.missingFields.length > 0 ? 1 : 0;
      const sectionMissing = chapter.children.reduce((sectionSum, section) => {
        const ownSectionMissing = section.missingFields.length > 0 ? 1 : 0;
        const subsectionMissing = section.children.reduce((subSum, subsection) => subSum + (subsection.missingFields.length > 0 ? 1 : 0), 0);
        return sectionSum + ownSectionMissing + subsectionMissing;
      }, 0);
      return chapterSum + ownMissing + sectionMissing;
    }, 0);
    return sum + unitMissing + chapterMissing;
  }, 0);

  return {
    nodes,
    chapterCount: totalChapterCount,
    sectionCount: totalSectionCount,
    subsectionCount: totalSubsectionCount,
    missingCount,
  };
}
