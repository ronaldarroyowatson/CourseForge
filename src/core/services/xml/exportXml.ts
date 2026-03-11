import { loadChapterExportNode, loadSectionExportNode, loadTextbookExportNode } from "./exportData";
import { assertValidId } from "./errors";
import { formatCurriculumXml } from "./formatXml";
import type { XmlMetadata } from "./types";

export async function exportTextbookXml(
  textbookId: string,
  metadata: XmlMetadata = {}
): Promise<string> {
  assertValidId(textbookId, "Textbook ID");
  const data = await loadTextbookExportNode(textbookId);
  return formatCurriculumXml(data, metadata);
}

export async function exportChapterXml(
  chapterId: string,
  metadata: XmlMetadata = {}
): Promise<string> {
  assertValidId(chapterId, "Chapter ID");
  const data = await loadChapterExportNode(chapterId);
  return formatCurriculumXml(data, metadata);
}

export async function exportSectionXml(
  sectionId: string,
  metadata: XmlMetadata = {}
): Promise<string> {
  assertValidId(sectionId, "Section ID");
  const data = await loadSectionExportNode(sectionId);
  return formatCurriculumXml(data, metadata);
}
