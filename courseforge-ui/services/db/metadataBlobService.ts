import type { BlobPayloadDocument, MetadataDocument } from '../../../otto-extensions/database-extension/schema/firestore-schema.js';
import { dbClient } from './dbClient.js';

export interface MetadataBlobWriteInput {
  id?: string;
  ownerId: string;
  textbookId: string;
  category: string;
  terms: string[];
  contentType: string;
  encoding: 'base64' | 'utf8';
  payload: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MetadataBlobService {
  writeMetadataBlob(input: MetadataBlobWriteInput): Promise<{ metadata: MetadataDocument; blob: BlobPayloadDocument }>;
  searchMetadataDocuments(input: {
    ownerId: string;
    textbookId?: string;
    category?: string;
    query?: string;
    limit?: number;
  }): Promise<MetadataDocument[]>;
  fetchBlobPayload(input: { ownerId: string; blobId: string }): Promise<BlobPayloadDocument | null>;
}

export class DefaultMetadataBlobService implements MetadataBlobService {
  async writeMetadataBlob(input: MetadataBlobWriteInput): Promise<{ metadata: MetadataDocument; blob: BlobPayloadDocument }> {
    return dbClient.run('writeMetadataBlob', input);
  }

  async searchMetadataDocuments(input: {
    ownerId: string;
    textbookId?: string;
    category?: string;
    query?: string;
    limit?: number;
  }): Promise<MetadataDocument[]> {
    return dbClient.run('searchMetadataDocuments', input);
  }

  async fetchBlobPayload(input: { ownerId: string; blobId: string }): Promise<BlobPayloadDocument | null> {
    return dbClient.run('fetchBlobPayload', input);
  }
}
