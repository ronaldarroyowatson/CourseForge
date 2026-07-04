import type { DbCommandHandler } from './command-types.js';

export const updateSharedContent: DbCommandHandler<'updateSharedContent'> = async (provider, payload) => {
  const documentId = payload.id ?? payload.textbookId;
  const ownershipRecords = await provider.queryDocuments(
    'ownershipVerification',
    (record) => record.textbookId === payload.textbookId
  );

  const allowedOwners = Array.from(
    new Set(
      ownershipRecords
        .map((record) => record.ownerId)
        .filter((ownerId) => ownerId !== payload.ownerId)
    )
  );

  const now = new Date().toISOString();

  return provider.setDocument('sharedContent', documentId, {
    textbookId: payload.textbookId,
    ownerId: payload.ownerId,
    allowedOwners,
    sharedContentRefs: payload.sharedContentRefs,
    createdAt: payload.createdAt ?? now,
    updatedAt: payload.updatedAt ?? now
  });
};
