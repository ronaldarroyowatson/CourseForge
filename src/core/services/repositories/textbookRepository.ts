import type { Textbook } from "../../models";
import { delete as deleteRecord, getAll, getById, save, STORE_NAMES } from "../db";

export async function saveTextbook(textbook: Textbook): Promise<string> {
  return save(STORE_NAMES.textbooks, textbook);
}

export async function getTextbookById(id: string): Promise<Textbook | undefined> {
  return getById(STORE_NAMES.textbooks, id);
}

export async function listTextbooks(): Promise<Textbook[]> {
  return getAll(STORE_NAMES.textbooks);
}

export async function deleteTextbook(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.textbooks, id);
}
