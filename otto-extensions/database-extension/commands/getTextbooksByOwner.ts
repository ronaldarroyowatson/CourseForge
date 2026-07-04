import type { DbCommandHandler } from './command-types.js';

export const getTextbooksByOwner: DbCommandHandler<'getTextbooksByOwner'> = async (provider, payload) => {
  return provider.queryDocuments('textbooks', (document) => document.ownerId === payload.ownerId);
};
