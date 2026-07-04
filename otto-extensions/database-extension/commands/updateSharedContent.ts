import type { DbCommandHandler } from './command-types.js';

export const updateSharedContent: DbCommandHandler<'updateSharedContent'> = async (provider, payload) => {
  const documentId = payload.id ?? payload.textbookId;
  return provider.setDocument('sharedContent', documentId, {
    textbookId: payload.textbookId,
    ownerId: payload.ownerId,
    allowedOwners: payload.allowedOwners,
    sharedContentRefs: payload.sharedContentRefs,
    createdAt: payload.createdAt
  });
};
