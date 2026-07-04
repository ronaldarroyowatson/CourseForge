import type { OwnershipVerificationRecord } from '../models.js';
import { dbClient } from './dbClient.js';

export interface OwnershipRecordService {
  verifyOwnership(input: {
    id?: string;
    textbookId: string;
    ownerId: string;
    coverImageHash: string;
  }): Promise<OwnershipVerificationRecord>;
}

export class DefaultOwnershipRecordService implements OwnershipRecordService {
  async verifyOwnership(input: {
    id?: string;
    textbookId: string;
    ownerId: string;
    coverImageHash: string;
  }): Promise<OwnershipVerificationRecord> {
    return dbClient.run('verifyOwnership', input);
  }
}
