import type { UserRecord } from '../models.js';
import { dbClient } from '../db/dbClient.js';

export interface UserService {
  getUser(uid: string): Promise<UserRecord | null>;
  createUser(userData: UserRecord): Promise<UserRecord>;
  updateLastLogin(uid: string, lastLogin?: string): Promise<UserRecord>;
}

export class DefaultUserService implements UserService {
  async getUser(uid: string): Promise<UserRecord | null> {
    return dbClient.run('getUser', { uid });
  }

  async createUser(userData: UserRecord): Promise<UserRecord> {
    return dbClient.run('createUser', userData);
  }

  async updateLastLogin(uid: string, lastLogin = new Date().toISOString()): Promise<UserRecord> {
    return dbClient.run('updateUserLoginTimestamp', { uid, lastLogin });
  }
}
