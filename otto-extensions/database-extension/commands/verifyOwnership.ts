import type { DbCommandHandler } from './command-types.js';

export const verifyOwnership: DbCommandHandler<'verifyOwnership'> = async (provider, payload) => {
  const documentId = payload.id ?? `${payload.ownerId}:${payload.textbookId}`;
  return provider.setDocument('ownershipVerification', documentId, {
    id: documentId,
    textbookId: payload.textbookId,
    ownerId: payload.ownerId,
    coverImageHash: payload.coverImageHash,
    verificationMethod: 'pHash',
    verifiedAt: payload.verifiedAt ?? new Date().toISOString()
  });
};
