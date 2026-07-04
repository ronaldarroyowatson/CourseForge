import type { DatabaseProvider } from '../providers/provider-types.js';
import type {
  OwnershipVerificationDocument,
  SharedContentDocument,
  TeacherCreatedContentDocument,
  TextbookDocument,
  UserDocument
} from '../schema/firestore-schema.js';

export type DbCommandName =
  | 'getUser'
  | 'createUser'
  | 'updateUserLoginTimestamp'
  | 'getTextbook'
  | 'getTextbooksByOwner'
  | 'createTextbook'
  | 'updateTextbook'
  | 'verifyOwnership'
  | 'getTeacherContent'
  | 'updateTeacherContent'
  | 'getSharedContent'
  | 'updateSharedContent';

export interface DbCommandPayloads {
  getUser: { uid: string };
  createUser: UserDocument;
  updateUserLoginTimestamp: { uid: string; lastLogin: string };
  getTextbook: { id: string };
  getTextbooksByOwner: { ownerId: string };
  createTextbook: TextbookDocument;
  updateTextbook: { id: string; updates: Partial<TextbookDocument> };
  verifyOwnership: { id?: string; textbookId: string; ownerId: string; coverImageHash: string };
  getTeacherContent: { id?: string; textbookId?: string };
  updateTeacherContent: {
    id?: string;
    textbookId: string;
    ownerId: string;
    vocabTerms: unknown[];
    equations: unknown[];
    concepts: unknown[];
    keyIdeas: unknown[];
    createdAt?: string;
    updatedAt: string;
  };
  getSharedContent: { id?: string; textbookId?: string };
  updateSharedContent: {
    id?: string;
    textbookId: string;
    ownerId: string;
    allowedOwners: string[];
    sharedContentRefs: unknown[];
    createdAt: string;
  };
}

export interface DbCommandResults {
  getUser: UserDocument | null;
  createUser: UserDocument;
  updateUserLoginTimestamp: UserDocument;
  getTextbook: TextbookDocument | null;
  getTextbooksByOwner: TextbookDocument[];
  createTextbook: TextbookDocument;
  updateTextbook: TextbookDocument;
  verifyOwnership: OwnershipVerificationDocument;
  getTeacherContent: TeacherCreatedContentDocument | null;
  updateTeacherContent: TeacherCreatedContentDocument;
  getSharedContent: SharedContentDocument | null;
  updateSharedContent: SharedContentDocument;
}

export type DbCommandHandler<TCommand extends DbCommandName> = (
  provider: DatabaseProvider,
  payload: DbCommandPayloads[TCommand]
) => Promise<DbCommandResults[TCommand]>;
