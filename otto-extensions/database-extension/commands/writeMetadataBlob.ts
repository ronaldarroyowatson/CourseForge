import type { DbCommandHandler } from './command-types.js';

export const writeMetadataBlob: DbCommandHandler<'writeMetadataBlob'> = async (provider, payload) => {
  const now = new Date().toISOString();
  const id = payload.id ?? `${payload.textbookId}:${payload.category}:${Math.random().toString(36).slice(2, 10)}`;
  const blobId = `${id}:blob`;

  const metadata = await provider.setDocument('metadataDocuments', id, {
    id,
    ownerId: payload.ownerId,
    textbookId: payload.textbookId,
    category: payload.category,
    terms: payload.terms,
    blobId,
    contentType: payload.contentType,
    createdAt: payload.createdAt ?? now,
    updatedAt: payload.updatedAt ?? now
  });

  const blob = await provider.setDocument('blobPayloads', blobId, {
    id: blobId,
    ownerId: payload.ownerId,
    textbookId: payload.textbookId,
    contentType: payload.contentType,
    encoding: payload.encoding,
    payload: payload.payload,
    createdAt: payload.createdAt ?? now,
    updatedAt: payload.updatedAt ?? now
  });

  return {
    metadata,
    blob
  };
};
