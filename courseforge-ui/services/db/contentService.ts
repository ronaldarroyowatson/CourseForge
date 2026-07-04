import type { SharedContentRecord, TeacherCreatedContentRecord } from '../models.js';
import { dbClient } from './dbClient.js';

export interface ContentService {
  getTeacherContent(input: { id?: string; textbookId?: string }): Promise<TeacherCreatedContentRecord | null>;
  updateTeacherContent(input: {
    id?: string;
    textbookId: string;
    ownerId: string;
    vocabTerms: unknown[];
    equations: unknown[];
    concepts: unknown[];
    keyIdeas: unknown[];
    createdAt?: string;
    updatedAt: string;
  }): Promise<TeacherCreatedContentRecord>;
  getSharedContent(input: {
    id?: string;
    textbookId?: string;
    ownerId: string;
    tolerance?: number;
  }): Promise<SharedContentRecord | null>;
  updateSharedContent(input: {
    id?: string;
    textbookId: string;
    ownerId: string;
    sharedContentRefs: unknown[];
    createdAt?: string;
    updatedAt?: string;
  }): Promise<SharedContentRecord>;
}

export class DefaultContentService implements ContentService {
  async getTeacherContent(input: { id?: string; textbookId?: string }): Promise<TeacherCreatedContentRecord | null> {
    return dbClient.run('getTeacherContent', input);
  }

  async updateTeacherContent(input: {
    id?: string;
    textbookId: string;
    ownerId: string;
    vocabTerms: unknown[];
    equations: unknown[];
    concepts: unknown[];
    keyIdeas: unknown[];
    createdAt?: string;
    updatedAt: string;
  }): Promise<TeacherCreatedContentRecord> {
    return dbClient.run('updateTeacherContent', input);
  }

  async getSharedContent(input: {
    id?: string;
    textbookId?: string;
    ownerId: string;
    tolerance?: number;
  }): Promise<SharedContentRecord | null> {
    return dbClient.run('getSharedContent', input);
  }

  async updateSharedContent(input: {
    id?: string;
    textbookId: string;
    ownerId: string;
    sharedContentRefs: unknown[];
    createdAt?: string;
    updatedAt?: string;
  }): Promise<SharedContentRecord> {
    return dbClient.run('updateSharedContent', input);
  }
}
