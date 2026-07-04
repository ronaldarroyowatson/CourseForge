import type { DbCommandHandler } from './command-types.js';

export const fetchBlobPayload: DbCommandHandler<'fetchBlobPayload'> = async (provider, payload) => {
  const blob = await provider.getDocument('blobPayloads', payload.blobId);
  if (!blob) {
    return null;
  }

  if (blob.ownerId !== payload.ownerId) {
    return null;
  }

  return blob;
};
