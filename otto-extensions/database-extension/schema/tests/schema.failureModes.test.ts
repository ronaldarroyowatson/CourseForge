import { describe, expect, it } from 'vitest';
import { firestoreSchemaCollections } from '../firestore-schema.js';

describe('schema.failureModes', () => {
  it('fails if duplicate collection names are introduced', () => {
    const uniqueSize = new Set(firestoreSchemaCollections).size;
    expect(uniqueSize).toBe(firestoreSchemaCollections.length);
  });
});
