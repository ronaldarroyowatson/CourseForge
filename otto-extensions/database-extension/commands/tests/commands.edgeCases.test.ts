import { describe, expect, it } from 'vitest';
import { createDbService } from '../../services/dbService.js';

describe('commands.edgeCases', () => {
  it('returns empty array for missing owner textbooks', async () => {
    const db = createDbService();
    const textbooks = await db.executeCommand('getTextbooksByOwner', { ownerId: 'missing-owner' });
    expect(textbooks).toEqual([]);
  });

  it('handles large textbook collections for owner filtering', async () => {
    const db = createDbService();
    for (let i = 0; i < 120; i += 1) {
      await db.executeCommand('createTextbook', {
        id: `tb-${i}`,
        ownerId: i % 2 === 0 ? 'owner-even' : 'owner-odd',
        title: `Book ${i}`,
        status: 'new',
        coverImageHash: 'h',
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z'
      });
    }

    const even = await db.executeCommand('getTextbooksByOwner', { ownerId: 'owner-even' });
    expect(even.length).toBe(60);
  });
});
