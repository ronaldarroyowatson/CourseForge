import type { Chapter } from "../../models";
import { delete as deleteRecord, getAll, getById, save, STORE_NAMES } from "../db";

export async function saveChapter(chapter: Chapter): Promise<string> {
  return save(STORE_NAMES.chapters, chapter);
}

export async function getChapterById(id: string): Promise<Chapter | undefined> {
  return getById(STORE_NAMES.chapters, id);
}

export async function listChapters(): Promise<Chapter[]> {
  return getAll(STORE_NAMES.chapters);
}

export async function listChaptersByTextbookId(textbookId: string): Promise<Chapter[]> {
  const chapters = await listChapters();
  return chapters
    .filter((chapter) => chapter.textbookId === textbookId)
    .sort((a, b) => a.index - b.index);
}

export async function deleteChapter(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.chapters, id);
}

export async function updateChapter(id: string, changes: Partial<Chapter>): Promise<Chapter> {
  const existing = await getChapterById(id);
  if (!existing) {
    throw new Error(`Chapter with id ${id} not found.`);
  }

  const updated: Chapter = {
    ...existing,
    ...changes,
    id: existing.id,
    textbookId: existing.textbookId,
    lastModified: new Date().toISOString(),
    pendingSync: true,
  };

  await saveChapter(updated);
  return updated;
}
