import { describe, expect, it } from 'vitest';
import { FirestoreProvider } from '../firestoreProvider.js';
import { ProviderDocumentError } from '../provider-types.js';

describe('providers.failureModes', () => {
  it('throws when updating a missing document', async () => {
    const provider = new FirestoreProvider({ context: {}, strictApiKey: false });

    await expect(provider.updateDocument('users', 'missing', { displayName: 'X' })).rejects.toBeInstanceOf(ProviderDocumentError);
  });

  it('throws strict api key validation error when key is missing', async () => {
    const provider = new FirestoreProvider({ context: {}, strictApiKey: true });

    await expect(provider.testConnection()).rejects.toThrow('Missing FIRESTORE_API_KEY');
  });
});
