import type { KeyIdea } from "../../models";
import { delete as deleteRecord, getAll, getById, save, STORE_NAMES } from "../db";

export async function saveKeyIdea(keyIdea: KeyIdea): Promise<string> {
  return save(STORE_NAMES.keyIdeas, keyIdea);
}

export async function getKeyIdeaById(id: string): Promise<KeyIdea | undefined> {
  return getById(STORE_NAMES.keyIdeas, id);
}

export async function listKeyIdeas(): Promise<KeyIdea[]> {
  return getAll(STORE_NAMES.keyIdeas);
}

export async function listKeyIdeasBySectionId(sectionId: string): Promise<KeyIdea[]> {
  const keyIdeas = await listKeyIdeas();
  return keyIdeas.filter((keyIdea) => keyIdea.sectionId === sectionId);
}

export async function deleteKeyIdea(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.keyIdeas, id);
}
