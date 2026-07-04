import type { CollectionName, FirestoreSchemaCollections } from '../schema/firestore-schema.js';
import { firestoreSchemaCollections } from '../schema/firestore-schema.js';
import { ProviderConnectionError, ProviderDocumentError, type DatabaseProvider, type ProviderContext } from './provider-types.js';

export interface FirestoreProviderOptions {
  context: ProviderContext;
  strictApiKey: boolean;
}

export class FirestoreProvider implements DatabaseProvider {
  readonly providerName = 'firestore' as const;

  private readonly options: FirestoreProviderOptions;
  private readonly store = new Map<CollectionName, Map<string, unknown>>();

  constructor(options: FirestoreProviderOptions) {
    this.options = options;

    for (const collectionName of firestoreSchemaCollections) {
      this.store.set(collectionName, new Map<string, unknown>());
    }
  }

  async testConnection(): Promise<boolean> {
    if (this.options.strictApiKey && !this.options.context.apiKey) {
      throw new ProviderConnectionError(this.providerName, 'Missing FIRESTORE_API_KEY.');
    }

    return true;
  }

  async getDocument<TCollection extends CollectionName>(
    collection: TCollection,
    id: string
  ): Promise<FirestoreSchemaCollections[TCollection] | null> {
    const collectionStore = this.getCollectionStore(collection);
    const document = collectionStore.get(id);
    return (document ?? null) as FirestoreSchemaCollections[TCollection] | null;
  }

  async setDocument<TCollection extends CollectionName>(
    collection: TCollection,
    id: string,
    document: FirestoreSchemaCollections[TCollection]
  ): Promise<FirestoreSchemaCollections[TCollection]> {
    const collectionStore = this.getCollectionStore(collection);
    collectionStore.set(id, document);
    return document;
  }

  async updateDocument<TCollection extends CollectionName>(
    collection: TCollection,
    id: string,
    partial: Partial<FirestoreSchemaCollections[TCollection]>
  ): Promise<FirestoreSchemaCollections[TCollection]> {
    const collectionStore = this.getCollectionStore(collection);
    const existing = collectionStore.get(id);

    if (!existing) {
      throw new ProviderDocumentError(this.providerName, `Cannot update missing document ${collection}/${id}`);
    }

    const updated = {
      ...(existing as Record<string, unknown>),
      ...partial
    } as unknown as FirestoreSchemaCollections[TCollection];
    collectionStore.set(id, updated);
    return updated;
  }

  async queryDocuments<TCollection extends CollectionName>(
    collection: TCollection,
    predicate: (document: FirestoreSchemaCollections[TCollection]) => boolean
  ): Promise<Array<FirestoreSchemaCollections[TCollection]>> {
    const collectionStore = this.getCollectionStore(collection);
    const values = Array.from(collectionStore.values()) as Array<FirestoreSchemaCollections[TCollection]>;
    return values.filter((document) => predicate(document));
  }

  private getCollectionStore<TCollection extends CollectionName>(collection: TCollection): Map<string, unknown> {
    const collectionStore = this.store.get(collection);
    if (!collectionStore) {
      throw new ProviderDocumentError(this.providerName, `Unknown collection ${collection}`);
    }

    return collectionStore;
  }
}
