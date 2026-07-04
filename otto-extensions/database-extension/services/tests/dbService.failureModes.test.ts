import { describe, expect, it } from 'vitest';
import { DbRuleError, createDbService } from '../dbService.js';

describe('dbService.failureModes', () => {
  it('rejects createUser with missing required fields', async () => {
    const db = createDbService();

    await expect(
      db.executeCommand('createUser', {
        uid: 'x',
        email: '',
        displayName: 'User',
        createdAt: 'x',
        lastLogin: 'x',
        textbooks: []
      })
    ).rejects.toBeInstanceOf(DbRuleError);
  });

  it('rejects unknown shared content lookup shapes', async () => {
    const db = createDbService();
    await expect(db.executeCommand('getSharedContent', { ownerId: 'owner-a' })).rejects.toBeInstanceOf(DbRuleError);
  });

  it('rejects metadata writes with unsupported encoding', async () => {
    const db = createDbService();
    await expect(
      db.executeCommand('writeMetadataBlob', {
        ownerId: 'owner-a',
        textbookId: 'tb-1',
        category: 'chapter-summary',
        terms: ['x'],
        contentType: 'application/json',
        encoding: 'binary' as never,
        payload: '{}'
      })
    ).rejects.toBeInstanceOf(DbRuleError);
  });
});
