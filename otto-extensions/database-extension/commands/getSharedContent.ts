import type { DbCommandHandler } from './command-types.js';

export const getSharedContent: DbCommandHandler<'getSharedContent'> = async (provider, payload) => {
  const documentId = payload.id ?? payload.textbookId;
  if (!documentId) {
    return null;
  }

  return provider.getDocument('sharedContent', documentId);
};
