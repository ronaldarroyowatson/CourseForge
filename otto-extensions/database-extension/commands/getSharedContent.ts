import { compareHashes } from '../../../courseforge-services/ownership/pHashProvider.js';
import type { DbCommandHandler } from './command-types.js';

export const getSharedContent: DbCommandHandler<'getSharedContent'> = async (provider, payload) => {
  const documentId = payload.id ?? payload.textbookId;
  if (!documentId) {
    return null;
  }

  const textbookId = payload.textbookId ?? documentId;
  const sharedContent = await provider.getDocument('sharedContent', documentId);
  if (!sharedContent) {
    return null;
  }

  const requesterOwnership = await provider.queryDocuments(
    'ownershipVerification',
    (record) => record.ownerId === payload.ownerId && record.textbookId === textbookId
  );

  if (requesterOwnership.length === 0) {
    return null;
  }

  const textbook = await provider.getDocument('textbooks', textbookId);
  if (!textbook) {
    return null;
  }

  const tolerance = payload.tolerance ?? 10;
  const distance = compareHashes(requesterOwnership[0].coverImageHash, textbook.coverImageHash);
  if (distance > tolerance) {
    return null;
  }

  if (sharedContent.ownerId === payload.ownerId) {
    return sharedContent;
  }

  if (!sharedContent.allowedOwners.includes(payload.ownerId)) {
    return null;
  }

  return sharedContent;
};
