import { describe, expect, it } from 'vitest';
import { createDbService } from '../../services/dbService.js';

describe('commands.basic', () => {
  it('creates and reads user documents', async () => {
    const db = createDbService();
    await db.executeCommand('createUser', {
      uid: 'u1',
      email: 'u1@example.com',
      displayName: 'User One',
      createdAt: '2026-07-03T00:00:00.000Z',
      lastLogin: '2026-07-03T00:00:00.000Z',
      textbooks: []
    });

    const user = await db.executeCommand('getUser', { uid: 'u1' });
    expect(user?.uid).toBe('u1');
  });

  it('creates and queries textbooks by owner', async () => {
    const db = createDbService();
    await db.executeCommand('createTextbook', {
      id: 'tb-1',
      ownerId: 'owner-a',
      title: 'Book A',
      status: 'in-progress',
      coverImageHash: 'hash',
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: '2026-07-03T00:00:00.000Z'
    });

    const textbooks = await db.executeCommand('getTextbooksByOwner', { ownerId: 'owner-a' });
    expect(textbooks.length).toBe(1);
  });
});
