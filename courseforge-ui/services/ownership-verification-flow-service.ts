import type { ContentService } from './db/contentService.js';
import type { OwnershipRecordService } from './db/ownershipService.js';
import type { TextbookService } from './db/textbookService.js';
import {
  DefaultOwnershipService,
  canShareTeacherGeneratedContent,
  sanitizeSharedContentRefs,
  type OwnershipService
} from './ownership-service.js';
import type { SharedContentRecord, TextbookRecord } from './models.js';

export interface CreateVerifiedTextbookInput {
  textbookId: string;
  ownerId: string;
  title: string;
  coverImageBytes: Uint8Array;
}

export interface OwnershipVerificationStatus {
  textbookId: string;
  ownerId: string;
  verified: boolean;
  verificationMethod: 'pHash';
  verifiedAt: string;
}

export interface SharedContentAccessResult {
  verificationStatus: 'granted' | 'denied';
  reason: string;
  sharedContent: SharedContentRecord | null;
}

export class OwnershipVerificationFlowService {
  private readonly ownershipService: OwnershipService;
  private readonly textbookService: TextbookService;
  private readonly ownershipRecordService: OwnershipRecordService;
  private readonly contentService: ContentService;

  constructor(params: {
    textbookService: TextbookService;
    ownershipRecordService: OwnershipRecordService;
    contentService: ContentService;
    ownershipService?: OwnershipService;
  }) {
    this.textbookService = params.textbookService;
    this.ownershipRecordService = params.ownershipRecordService;
    this.contentService = params.contentService;
    this.ownershipService = params.ownershipService ?? new DefaultOwnershipService();
  }

  async createVerifiedTextbook(input: CreateVerifiedTextbookInput): Promise<{
    textbook: TextbookRecord;
    verification: OwnershipVerificationStatus;
  }> {
    const now = new Date().toISOString();
    const coverImageHash = this.ownershipService.computePerceptualHash(input.coverImageBytes);

    const textbook = await this.textbookService.createTextbook({
      id: input.textbookId,
      ownerId: input.ownerId,
      title: input.title,
      status: 'in-progress',
      verified: true,
      verificationMethod: 'pHash',
      coverImageHash,
      createdAt: now,
      updatedAt: now
    });

    const verificationRecord = await this.ownershipRecordService.verifyOwnership({
      textbookId: input.textbookId,
      ownerId: input.ownerId,
      coverImageHash,
      verifiedAt: now
    });

    return {
      textbook,
      verification: {
        textbookId: verificationRecord.textbookId,
        ownerId: verificationRecord.ownerId,
        verified: true,
        verificationMethod: 'pHash',
        verifiedAt: verificationRecord.verifiedAt
      }
    };
  }

  async getSharedContentForOwner(input: {
    textbookId: string;
    ownerId: string;
    tolerance?: number;
  }): Promise<SharedContentAccessResult> {
    const ownershipRecord = await this.ownershipRecordService.getOwnershipRecord({
      ownerId: input.ownerId,
      textbookId: input.textbookId
    });

    if (!ownershipRecord) {
      return {
        verificationStatus: 'denied',
        reason: 'No ownership verification record found for owner/textbook pair.',
        sharedContent: null
      };
    }

    const editionOwners = await this.ownershipRecordService.getEditionOwners({
      textbookId: input.textbookId,
      tolerance: input.tolerance
    });

    const requesterEdition = editionOwners.find((editionOwner) => editionOwner.ownerId === input.ownerId);
    if (!requesterEdition) {
      return {
        verificationStatus: 'denied',
        reason: 'pHash comparison did not match the textbook edition tolerance window.',
        sharedContent: null
      };
    }

    const sharedContent = await this.contentService.getSharedContent({
      textbookId: input.textbookId,
      ownerId: input.ownerId,
      tolerance: input.tolerance
    });

    if (!sharedContent) {
      return {
        verificationStatus: 'denied',
        reason: 'No shared content available for this owner and textbook.',
        sharedContent: null
      };
    }

    const safeRefs = sanitizeSharedContentRefs(sharedContent.sharedContentRefs);
    const shareAllowed = canShareTeacherGeneratedContent({
      isSameEditionOwner: true,
      includesTeacherCreatedContent: safeRefs.some((ref) => ref.source === 'teacher-created'),
      includesStructuralMetadataOnly: safeRefs.every((ref) => ref.source === 'structural-metadata'),
      includesCopyrightedMaterial: safeRefs.length !== sharedContent.sharedContentRefs.length
    });

    if (!shareAllowed) {
      return {
        verificationStatus: 'denied',
        reason: 'Content failed copyright-safe sharing checks.',
        sharedContent: null
      };
    }

    return {
      verificationStatus: 'granted',
      reason: 'Ownership verified with pHash and content passed safety checks.',
      sharedContent: {
        ...sharedContent,
        sharedContentRefs: safeRefs
      }
    };
  }
}
