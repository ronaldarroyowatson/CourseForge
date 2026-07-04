import type { DbCommandHandler } from './command-types.js';

export const verifyOwnership: DbCommandHandler<'verifyOwnership'> = async (provider, payload) => {
  const documentId = payload.id ?? payload.textbookId;
  return provider.setDocument('ownershipVerification', documentId, {
    textbookId: payload.textbookId,
    ownerId: payload.ownerId,
    coverImageHash: payload.coverImageHash,
    verificationMethod: 'pHash',
    verifiedAt: new Date().toISOString()
  });
};
