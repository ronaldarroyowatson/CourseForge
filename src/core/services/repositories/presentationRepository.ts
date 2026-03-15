import type { ExtractedPresentation } from "../../models";
import { delete as deleteRecord, getAll, getById, save, STORE_NAMES } from "../db";

export async function saveExtractedPresentation(presentation: ExtractedPresentation): Promise<string> {
  return save(STORE_NAMES.extractedPresentations, presentation);
}

export async function getExtractedPresentationById(id: string): Promise<ExtractedPresentation | undefined> {
  return getById(STORE_NAMES.extractedPresentations, id);
}

export async function listExtractedPresentations(): Promise<ExtractedPresentation[]> {
  return getAll(STORE_NAMES.extractedPresentations);
}

export async function listExtractedPresentationsBySectionId(sectionId: string): Promise<ExtractedPresentation[]> {
  const rows = await listExtractedPresentations();
  return rows.filter((row) => row.sectionId === sectionId);
}

export async function deleteExtractedPresentation(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.extractedPresentations, id);
}
