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

export async function deleteSection(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.sections, id);
}
