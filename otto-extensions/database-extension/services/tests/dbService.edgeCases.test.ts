import { describe, expect, it } from 'vitest';
import { createDbService } from '../dbService.js';

describe('dbService.edgeCases', () => {
  it('handles empty textbook arrays on created user payload', async () => {
    const db = createDbService();
    const user = await db.executeCommand('createUser', {
      uid: 'edge-user',
      email: 'edge-user@example.com',
      displayName: 'Edge User',
      createdAt: 'x',
      lastLogin: 'x',
      textbooks: []
    });

    expect(user.textbooks).toEqual([]);
  });

  it('supports long string fields', async () => {
    const db = createDbService();
    const longTitle = 'T'.repeat(4000);

    const textbook = await db.executeCommand('createTextbook', {
      id: 'edge-textbook',
      ownerId: 'owner-edge',
      title: longTitle,
      status: 'new',
      coverImageHash: 'h',
      createdAt: 'x',
      updatedAt: 'x'
    });

    expect(textbook.title.length).toBe(4000);
  });
});
