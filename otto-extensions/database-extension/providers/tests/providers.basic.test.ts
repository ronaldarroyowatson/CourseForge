import { describe, expect, it } from 'vitest';
import { FirestoreProvider } from '../firestoreProvider.js';

describe('providers.basic', () => {
  it('stores and retrieves documents', async () => {
    const provider = new FirestoreProvider({ context: {}, strictApiKey: false });
    await provider.setDocument('users', 'u-1', {
      uid: 'u-1',
      email: 'u-1@example.com',
      displayName: 'U1',
      createdAt: 'x',
      lastLogin: 'x',
      textbooks: []
    });

    const result = await provider.getDocument('users', 'u-1');
    expect(result?.uid).toBe('u-1');
  });
});
