import type { Section } from "../../models";
import { delete as deleteRecord, getAll, getById, save, STORE_NAMES } from "../db";

export async function saveSection(section: Section): Promise<string> {
  return save(STORE_NAMES.sections, section);
}

export async function getSectionById(id: string): Promise<Section | undefined> {
  return getById(STORE_NAMES.sections, id);
}

export async function listSections(): Promise<Section[]> {
  return getAll(STORE_NAMES.sections);
}

export async function listSectionsByChapterId(chapterId: string): Promise<Section[]> {
  const sections = await listSections();
  return sections
    .filter((section) => section.chapterId === chapterId)
    .sort((a, b) => a.index - b.index);
}

export async function countSectionsByTextbookId(textbookId: string): Promise<number> {
  const sections = await listSections();
  return sections.filter((section) => section.textbookId === textbookId).length;
}

export async function deleteSection(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.sections, id);
}

export async function updateSection(id: string, changes: Partial<Section>): Promise<Section> {
  const existing = await getSectionById(id);
  if (!existing) {
    throw new Error(`Section with id ${id} not found.`);
  }

  const updated: Section = {
    ...existing,
    ...changes,
    id: existing.id,
    chapterId: existing.chapterId,
    textbookId: existing.textbookId,
    lastModified: new Date().toISOString(),
    pendingSync: true,
  };

  await saveSection(updated);
  return updated;
}
