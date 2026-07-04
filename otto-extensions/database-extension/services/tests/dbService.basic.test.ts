import { describe, expect, it } from 'vitest';
import { createDbService } from '../dbService.js';

describe('dbService.basic', () => {
  it('executes create and read commands through db service', async () => {
    const db = createDbService();
    await db.executeCommand('createUser', {
      uid: 'svc-user',
      email: 'svc-user@example.com',
      displayName: 'Svc User',
      createdAt: 'x',
      lastLogin: 'x',
      textbooks: []
    });

    const user = await db.executeCommand('getUser', { uid: 'svc-user' });
    expect(user?.uid).toBe('svc-user');
  });

  it('tests provider connectivity API', async () => {
    const db = createDbService();
    const status = await db.testConnections();
    expect(typeof status.firestore === 'boolean' && typeof status.cosmos === 'boolean').toBe(true);
  });
});
