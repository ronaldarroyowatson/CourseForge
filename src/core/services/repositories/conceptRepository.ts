import type { Concept } from "../../models";
import { delete as deleteRecord, getAll, getById, save, STORE_NAMES } from "../db";

export async function saveConcept(concept: Concept): Promise<string> {
  return save(STORE_NAMES.concepts, concept);
}

export async function getConceptById(id: string): Promise<Concept | undefined> {
  return getById(STORE_NAMES.concepts, id);
}

export async function listConcepts(): Promise<Concept[]> {
  return getAll(STORE_NAMES.concepts);
}

export async function listConceptsBySectionId(sectionId: string): Promise<Concept[]> {
  const concepts = await listConcepts();
  return concepts.filter((concept) => concept.sectionId === sectionId);
}

export async function deleteConcept(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.concepts, id);
}
