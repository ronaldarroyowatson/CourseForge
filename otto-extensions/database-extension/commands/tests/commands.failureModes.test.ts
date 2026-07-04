import { describe, expect, it } from 'vitest';
import { DbRuleError, createDbService } from '../../services/dbService.js';

describe('commands.failureModes', () => {
  it('rejects empty uid for getUser', async () => {
    const db = createDbService();
    await expect(db.executeCommand('getUser', { uid: '' })).rejects.toBeInstanceOf(DbRuleError);
  });

  it('rejects malformed getTeacherContent input with no id and no textbookId', async () => {
    const db = createDbService();
    await expect(db.executeCommand('getTeacherContent', {})).rejects.toBeInstanceOf(DbRuleError);
  });
});
