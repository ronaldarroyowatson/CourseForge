import type { OwnershipVerificationRecord } from '../models.js';
import { dbClient } from './dbClient.js';

export interface EditionOwnerRecord {
  ownerId: string;
  textbookId: string;
  coverImageHash: string;
  hammingDistance: number;
}

export interface OwnershipRecordService {
  verifyOwnership(input: {
    id?: string;
    textbookId: string;
    ownerId: string;
    coverImageHash: string;
    verifiedAt?: string;
  }): Promise<OwnershipVerificationRecord>;
  getOwnershipRecord(input: { ownerId: string; textbookId: string }): Promise<OwnershipVerificationRecord | null>;
  getEditionOwners(input: { textbookId: string; tolerance?: number }): Promise<EditionOwnerRecord[]>;
}

export class DefaultOwnershipRecordService implements OwnershipRecordService {
  async verifyOwnership(input: {
    id?: string;
    textbookId: string;
    ownerId: string;
    coverImageHash: string;
    verifiedAt?: string;
  }): Promise<OwnershipVerificationRecord> {
    return dbClient.run('verifyOwnership', input);
  }

  async getOwnershipRecord(input: { ownerId: string; textbookId: string }): Promise<OwnershipVerificationRecord | null> {
    return dbClient.run('getOwnershipRecord', input);
  }

  async getEditionOwners(input: { textbookId: string; tolerance?: number }): Promise<EditionOwnerRecord[]> {
    return dbClient.run('getEditionOwners', input);
  }
}
