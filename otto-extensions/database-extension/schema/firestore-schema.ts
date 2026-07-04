export type TextbookStatus = 'new' | 'in-progress' | 'completed';

export interface UserDocument {
  uid: string;
  email: string;
  displayName: string;
  createdAt: string;
  lastLogin: string;
  textbooks: string[];
}

export interface TextbookDocument {
  id: string;
  ownerId: string;
  title: string;
  status: TextbookStatus;
  coverImageHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface TextbookMetadataDocument {
  textbookId: string;
  chapters: unknown[];
  sections: unknown[];
  structuralMap: Record<string, unknown>;
  lastUpdated: string;
}

export interface TeacherCreatedContentDocument {
  textbookId: string;
  ownerId: string;
  vocabTerms: unknown[];
  equations: unknown[];
  concepts: unknown[];
  keyIdeas: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface OwnershipVerificationDocument {
  id?: string;
  textbookId: string;
  ownerId: string;
  coverImageHash: string;
  verificationMethod: 'pHash';
  verifiedAt: string;
}

export interface EditionOwnerRecord {
  ownerId: string;
  textbookId: string;
  coverImageHash: string;
  hammingDistance: number;
}

export interface SharedContentDocument {
  textbookId: string;
  ownerId: string;
  allowedOwners: string[];
  sharedContentRefs: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreSchemaCollections {
  users: UserDocument;
  textbooks: TextbookDocument;
  textbookMetadata: TextbookMetadataDocument;
  teacherCreatedContent: TeacherCreatedContentDocument;
  ownershipVerification: OwnershipVerificationDocument;
  sharedContent: SharedContentDocument;
}

export type CollectionName = keyof FirestoreSchemaCollections;

export const firestoreSchemaCollections: CollectionName[] = [
  'users',
  'textbooks',
  'textbookMetadata',
  'teacherCreatedContent',
  'ownershipVerification',
  'sharedContent'
];
