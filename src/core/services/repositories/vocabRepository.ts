import type { VocabTerm } from "../../models";
import { delete as deleteRecord, getAll, getById, save, STORE_NAMES } from "../db";
import { getCurrentUser } from "../../../firebase/auth";

export async function saveVocabTerm(vocabTerm: VocabTerm): Promise<string> {
  return save(STORE_NAMES.vocabTerms, {
    ...vocabTerm,
    userId: vocabTerm.userId?.trim() || getCurrentUser()?.uid?.trim() || undefined,
  });
}

export async function getVocabTermById(id: string): Promise<VocabTerm | undefined> {
  return getById(STORE_NAMES.vocabTerms, id);
}

export async function listVocabTerms(): Promise<VocabTerm[]> {
  return getAll(STORE_NAMES.vocabTerms);
}

export async function listVocabTermsBySectionId(sectionId: string): Promise<VocabTerm[]> {
  const terms = await listVocabTerms();
  return terms.filter((term) => term.sectionId === sectionId);
}

export async function deleteVocabTerm(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.vocabTerms, id);
}
