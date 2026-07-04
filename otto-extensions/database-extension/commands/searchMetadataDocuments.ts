import type { DbCommandHandler } from './command-types.js';

export const searchMetadataDocuments: DbCommandHandler<'searchMetadataDocuments'> = async (provider, payload) => {
  const lowerQuery = payload.query?.trim().toLowerCase() ?? '';
  const maxResults = Math.min(Math.max(payload.limit ?? 25, 1), 200);

  const matches = await provider.queryDocuments('metadataDocuments', (document) => {
    if (document.ownerId !== payload.ownerId) {
      return false;
    }

    if (payload.textbookId && document.textbookId !== payload.textbookId) {
      return false;
    }

    if (payload.category && document.category !== payload.category) {
      return false;
    }

    if (!lowerQuery) {
      return true;
    }

    if (document.category.toLowerCase().includes(lowerQuery)) {
      return true;
    }

    return document.terms.some((term) => term.toLowerCase().includes(lowerQuery));
  });

  return matches.slice(0, maxResults);
};
