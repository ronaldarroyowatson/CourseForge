import type { TextbookRecord } from '../models.js';
import { dbClient } from './dbClient.js';

export interface TextbookService {
  getTextbook(id: string): Promise<TextbookRecord | null>;
  createTextbook(record: TextbookRecord): Promise<TextbookRecord>;
  updateTextbook(id: string, updates: Partial<TextbookRecord>): Promise<TextbookRecord>;
}

export class DefaultTextbookService implements TextbookService {
  async getTextbook(id: string): Promise<TextbookRecord | null> {
    return dbClient.run('getTextbook', { id });
  }

  async createTextbook(record: TextbookRecord): Promise<TextbookRecord> {
    return dbClient.run('createTextbook', record);
  }

  async updateTextbook(id: string, updates: Partial<TextbookRecord>): Promise<TextbookRecord> {
    return dbClient.run('updateTextbook', { id, updates });
  }
}
