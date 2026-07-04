import { describe, expect, it } from 'vitest';
import { CosmosProvider } from '../cosmosProvider.js';

describe('providers.edgeCases', () => {
  it('queries empty collections as empty arrays', async () => {
    const provider = new CosmosProvider({ context: {}, strictApiKey: false });
    const result = await provider.queryDocuments('users', () => true);
    expect(result).toEqual([]);
  });

  it('supports large query result sets deterministically', async () => {
    const provider = new CosmosProvider({ context: {}, strictApiKey: false });

    for (let i = 0; i < 300; i += 1) {
      await provider.setDocument('users', `u-${i}`, {
        uid: `u-${i}`,
        email: `u-${i}@example.com`,
        displayName: `User ${i}`,
        createdAt: 'x',
        lastLogin: 'x',
        textbooks: []
      });
    }

    const result = await provider.queryDocuments('users', (doc) => doc.uid.startsWith('u-'));
    expect(result.length).toBe(300);
  });
});
