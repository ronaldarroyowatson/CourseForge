import type { DbCommandHandler } from './command-types.js';

export const getOwnershipRecord: DbCommandHandler<'getOwnershipRecord'> = async (provider, payload) => {
  const records = await provider.queryDocuments(
    'ownershipVerification',
    (record) => record.ownerId === payload.ownerId && record.textbookId === payload.textbookId
  );

  if (records.length > 0) {
    return records[0];
  }

  return null;
};
