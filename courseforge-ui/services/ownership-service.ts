import {
  compareHashes,
  computeHash,
  isSameEdition,
  type HashImageInput
} from '../../courseforge-services/ownership/pHashProvider.js';

export interface OwnershipService {
  computePerceptualHash(image: HashImageInput): string;
  compareHashes(hashA: string, hashB: string): number;
  isSameEdition(hashA: string, hashB: string, tolerance?: number): boolean;
}

export class DefaultOwnershipService implements OwnershipService {
  computePerceptualHash(image: HashImageInput): string {
    return computeHash(image);
  }

  compareHashes(hashA: string, hashB: string): number {
    return compareHashes(hashA, hashB);
  }

  isSameEdition(hashA: string, hashB: string, tolerance = 10): boolean {
    return isSameEdition(hashA, hashB, tolerance);
  }
}

export function canShareTeacherGeneratedContent(params: {
  isSameEditionOwner: boolean;
  includesTeacherCreatedContent: boolean;
  includesStructuralMetadataOnly: boolean;
  includesCopyrightedMaterial: boolean;
}): boolean {
  return (
    params.isSameEditionOwner &&
    !params.includesCopyrightedMaterial &&
    (params.includesTeacherCreatedContent || params.includesStructuralMetadataOnly)
  );
}

export type ShareableContentType =
  | 'vocab'
  | 'concept-summary'
  | 'equation'
  | 'key-idea'
  | 'chapter-title'
  | 'section-name';

export interface SharedContentRef {
  type: ShareableContentType;
  source: 'teacher-created' | 'structural-metadata';
  value: string;
}

const ALLOWED_SHARED_TYPES = new Set<ShareableContentType>([
  'vocab',
  'concept-summary',
  'equation',
  'key-idea',
  'chapter-title',
  'section-name'
]);

export function sanitizeSharedContentRefs(sharedContentRefs: unknown[]): SharedContentRef[] {
  return sharedContentRefs.filter(isSafeSharedContentRef);
}

function isSafeSharedContentRef(value: unknown): value is SharedContentRef {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (!ALLOWED_SHARED_TYPES.has(candidate.type as ShareableContentType)) {
    return false;
  }

  if (candidate.source !== 'teacher-created' && candidate.source !== 'structural-metadata') {
    return false;
  }

  if (typeof candidate.value !== 'string' || candidate.value.trim().length === 0) {
    return false;
  }

  // Reject obvious textbook page or verbatim payload attempts.
  if (/\b(page|publisher|copyright|verbatim)\b/i.test(candidate.value)) {
    return false;
  }

  return true;
}
