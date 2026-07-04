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
    await expect(db.executeCommand('getSharedContent', {})).rejects.toBeInstanceOf(DbRuleError);
  });
});
