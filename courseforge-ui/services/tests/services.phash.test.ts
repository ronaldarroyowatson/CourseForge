import { describe, expect, it } from 'vitest';
import { compareHashes, computeHash, isSameEdition } from '../../../courseforge-services/ownership/pHashProvider.js';
import { OwnershipVerificationFlowService } from '../ownership-verification-flow-service.js';

describe('services.phash', () => {
  it('computes deterministic 64-bit pHash output as 16-char hex', () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const hashA = computeHash(bytes);
    const hashB = computeHash(bytes);

    expect(hashA).toHaveLength(16);
    expect(hashA).toBe(hashB);
  });

  it('compares hashes by Hamming distance and tolerance', () => {
    expect(compareHashes('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
    expect(compareHashes('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(isSameEdition('ffffffffffffffff', 'fffffffffffffffe', 1)).toBe(true);
    expect(isSameEdition('ffffffffffffffff', '0000000000000000', 10)).toBe(false);
  });

  it('creates verified textbook through DB-backed flow service', async () => {
    const service = new OwnershipVerificationFlowService({
      textbookService: {
        async getTextbook() {
          return null;
        },
        async createTextbook(record) {
          return record;
        },
        async updateTextbook(id, updates) {
          return {
            id,
            ownerId: 'owner-a',
            title: 'Book',
            status: 'in-progress',
            coverImageHash: 'ffffffffffffffff',
            createdAt: 'x',
            updatedAt: 'x',
            ...updates
          };
        }
      },
      ownershipRecordService: {
        async verifyOwnership(input) {
          return {
            textbookId: input.textbookId,
            ownerId: input.ownerId,
            coverImageHash: input.coverImageHash,
            verificationMethod: 'pHash',
            verifiedAt: input.verifiedAt ?? 'x'
          };
        },
        async getOwnershipRecord() {
          return null;
        },
        async getEditionOwners() {
          return [];
        }
      },
      contentService: {
        async getTeacherContent() {
          return null;
        },
        async updateTeacherContent(input) {
          return {
            textbookId: input.textbookId,
            ownerId: input.ownerId,
            vocabTerms: input.vocabTerms,
            equations: input.equations,
            concepts: input.concepts,
            keyIdeas: input.keyIdeas,
            createdAt: input.createdAt ?? 'x',
            updatedAt: input.updatedAt
          };
        },
        async getSharedContent() {
          return null;
        },
        async updateSharedContent(input) {
          return {
            textbookId: input.textbookId,
            ownerId: input.ownerId,
            allowedOwners: [],
            sharedContentRefs: input.sharedContentRefs,
            createdAt: input.createdAt ?? 'x',
            updatedAt: input.updatedAt ?? 'x'
          };
        }
      }
    });

    const result = await service.createVerifiedTextbook({
      textbookId: 'tb-1',
      ownerId: 'owner-a',
      title: 'Book',
      coverImageBytes: new Uint8Array([1, 2, 3, 4])
    });

    expect(result.textbook.verified).toBe(true);
    expect(result.verification.verificationMethod).toBe('pHash');
  });
});
