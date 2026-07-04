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

  it('stores ownership verification and resolves edition owners by pHash tolerance', async () => {
    const db = createDbService();
    await db.executeCommand('createTextbook', {
      id: 'tb-own',
      ownerId: 'owner-a',
      title: 'Book A',
      status: 'in-progress',
      coverImageHash: 'ffffffffffffffff',
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: '2026-07-03T00:00:00.000Z'
    });

    await db.executeCommand('verifyOwnership', {
      textbookId: 'tb-own',
      ownerId: 'owner-a',
      coverImageHash: 'ffffffffffffffff'
    });

    await db.executeCommand('verifyOwnership', {
      textbookId: 'tb-own',
      ownerId: 'owner-b',
      coverImageHash: 'fffffffffffffffe'
    });

    const ownership = await db.executeCommand('getOwnershipRecord', {
      ownerId: 'owner-a',
      textbookId: 'tb-own'
    });

    const editionOwners = await db.executeCommand('getEditionOwners', {
      textbookId: 'tb-own',
      tolerance: 2
    });

    expect(ownership?.ownerId).toBe('owner-a');
    expect(editionOwners.map((record) => record.ownerId)).toContain('owner-b');
  });

  it('gates shared content lookup by ownership verification and tolerance', async () => {
    const db = createDbService();
    await db.executeCommand('createTextbook', {
      id: 'tb-share',
      ownerId: 'owner-a',
      title: 'Book Share',
      status: 'in-progress',
      coverImageHash: 'ffffffffffffffff',
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: '2026-07-03T00:00:00.000Z'
    });

    await db.executeCommand('verifyOwnership', {
      textbookId: 'tb-share',
      ownerId: 'owner-a',
      coverImageHash: 'ffffffffffffffff'
    });

    await db.executeCommand('verifyOwnership', {
      textbookId: 'tb-share',
      ownerId: 'owner-b',
      coverImageHash: 'ffffffffffffffff'
    });

    await db.executeCommand('updateSharedContent', {
      textbookId: 'tb-share',
      ownerId: 'owner-a',
      sharedContentRefs: [{ type: 'vocab', source: 'teacher-created', value: 'mitosis' }]
    });

    const granted = await db.executeCommand('getSharedContent', {
      textbookId: 'tb-share',
      ownerId: 'owner-b',
      tolerance: 10
    });

    expect(granted?.textbookId).toBe('tb-share');
  });
});
