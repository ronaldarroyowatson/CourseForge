import type { CollectionName, FirestoreSchemaCollections } from '../schema/firestore-schema.js';

export interface ProviderContext {
  apiKey?: string;
  endpoint?: string;
  databaseName?: string;
}

export interface DatabaseProvider {
  readonly providerName: 'firestore' | 'cosmos';
  testConnection(): Promise<boolean>;
  getDocument<TCollection extends CollectionName>(
    collection: TCollection,
    id: string
  ): Promise<FirestoreSchemaCollections[TCollection] | null>;
  setDocument<TCollection extends CollectionName>(
    collection: TCollection,
    id: string,
    document: FirestoreSchemaCollections[TCollection]
  ): Promise<FirestoreSchemaCollections[TCollection]>;
  updateDocument<TCollection extends CollectionName>(
    collection: TCollection,
    id: string,
    partial: Partial<FirestoreSchemaCollections[TCollection]>
  ): Promise<FirestoreSchemaCollections[TCollection]>;
  queryDocuments<TCollection extends CollectionName>(
    collection: TCollection,
    predicate: (document: FirestoreSchemaCollections[TCollection]) => boolean
  ): Promise<Array<FirestoreSchemaCollections[TCollection]>>;
}

export class ProviderConnectionError extends Error {
  constructor(providerName: string, message: string) {
    super(`[${providerName}] ${message}`);
    this.name = 'ProviderConnectionError';
  }
}

export class ProviderDocumentError extends Error {
  constructor(providerName: string, message: string) {
    super(`[${providerName}] ${message}`);
    this.name = 'ProviderDocumentError';
  }
}
