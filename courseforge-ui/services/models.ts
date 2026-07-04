export type UiState = 'READY' | 'WAITING' | 'ON' | 'OFF' | 'UPDATED' | 'UP-TO-DATE';
export type OttoLifecycleState = 'OTTO_INIT' | 'OTTO_CHECKING' | 'OTTO_APPLYING' | 'OTTO_DONE';

export type TextbookStatus = 'new' | 'in-progress' | 'completed';

export interface UserRecord {
  uid: string;
  email: string;
  displayName: string;
  createdAt: string;
  lastLogin: string;
  textbooks: string[];
}

export interface TextbookRecord {
  id: string;
  ownerId: string;
  title: string;
  status: TextbookStatus;
  verified?: boolean;
  verificationMethod?: 'pHash';
  coverImageHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface TextbookMetadataRecord {
  textbookId: string;
  chapters: unknown[];
  sections: unknown[];
  structuralMap: Record<string, unknown>;
  lastUpdated: string;
}

export interface TeacherCreatedContentRecord {
  textbookId: string;
  ownerId: string;
  vocabTerms: unknown[];
  equations: unknown[];
  concepts: unknown[];
  keyIdeas: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface OwnershipVerificationRecord {
  textbookId: string;
  ownerId: string;
  coverImageHash: string;
  verificationMethod: 'pHash';
  verifiedAt: string;
}

export interface SharedContentRecord {
  textbookId: string;
  ownerId: string;
  allowedOwners: string[];
  sharedContentRefs: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface CourseForgeUiContext {
  ottoStatus: UiState;
  courseForgeStatus: UiState;
  telemetryStatus: UiState;
  splashStatus: UiState;
  authStatus: UiState;
  updateStatus: UiState;
  ottoLifecycleState: OttoLifecycleState;
  ottoOverlayVisible: boolean;
  loggingStatus: UiState;
  tracingStatus: UiState;
  metricsStatus: UiState;
  currentUser: {
    uid: string;
    displayName: string;
    avatarLabel: string;
  } | null;
  authLoading: boolean;
  authErrorMessage: string | null;
  textbooks: TextbookRecord[];
}

export interface CourseForgeUiRenderResult {
  title: string;
  html: string;
  indicators: Array<{
    label: string;
    state: UiState | OttoLifecycleState;
  }>;
}
