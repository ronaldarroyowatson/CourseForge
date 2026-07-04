import { compareHashes } from '../../../courseforge-services/ownership/pHashProvider.js';
import type { DbCommandHandler } from './command-types.js';

export const getEditionOwners: DbCommandHandler<'getEditionOwners'> = async (provider, payload) => {
  const textbook = await provider.getDocument('textbooks', payload.textbookId);
  if (!textbook) {
    return [];
  }

  const tolerance = payload.tolerance ?? 10;
  const ownershipRecords = await provider.queryDocuments('ownershipVerification', () => true);

  return ownershipRecords
    .map((record) => ({
      ownerId: record.ownerId,
      textbookId: record.textbookId,
      coverImageHash: record.coverImageHash,
      hammingDistance: compareHashes(textbook.coverImageHash, record.coverImageHash)
    }))
    .filter((record) => record.hammingDistance <= tolerance)
    .sort((left, right) => left.hammingDistance - right.hammingDistance);
};
