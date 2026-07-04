import { describe, expect, it } from 'vitest';
import { firestoreSchemaCollections } from '../firestore-schema.js';

describe('schema.basic', () => {
  it('includes expected base collections', () => {
    expect(firestoreSchemaCollections.includes('users') && firestoreSchemaCollections.includes('textbooks')).toBe(true);
  });
});
