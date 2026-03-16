import type { GameTextEntry } from "../../models";
import { delete as deleteRecord, getAll, getById, save, STORE_NAMES } from "../db";

function buildEntryId(gameId: string, entryId: string): string {
  return `${gameId}:${entryId}`;
}

export async function saveGameTextEntry(entry: GameTextEntry): Promise<string> {
  const normalized: GameTextEntry = {
    ...entry,
    id: buildEntryId(entry.gameId, entry.id.split(":").pop() ?? entry.id),
    defaultLanguage: entry.defaultLanguage.toLowerCase(),
    texts: Object.fromEntries(
      Object.entries(entry.texts).map(([language, value]) => [language.toLowerCase(), value])
    ),
  };

  return save(STORE_NAMES.gameText, normalized);
}

export async function getGameTextEntry(gameId: string, entryId: string): Promise<GameTextEntry | undefined> {
  return getById(STORE_NAMES.gameText, buildEntryId(gameId, entryId));
}

export async function listGameTextEntries(gameId?: string): Promise<GameTextEntry[]> {
  const all = await getAll(STORE_NAMES.gameText);
  if (!gameId) {
    return all;
  }

  return all.filter((entry) => entry.gameId === gameId);
}

export async function deleteGameTextEntry(gameId: string, entryId: string): Promise<void> {
  await deleteRecord(STORE_NAMES.gameText, buildEntryId(gameId, entryId));
}
