import { describe, expect, it } from 'vitest';
import { firestoreSchemaCollections } from '../firestore-schema.js';

describe('schema.edgeCases', () => {
  it('contains non-empty collection names', () => {
    expect(firestoreSchemaCollections.every((name) => name.trim().length > 0)).toBe(true);
  });

  it('supports deep-copy style operations without mutation', () => {
    const copy = [...firestoreSchemaCollections];
    copy.push('users');
    expect(firestoreSchemaCollections.length < copy.length).toBe(true);
  });
});
