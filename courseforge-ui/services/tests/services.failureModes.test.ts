import { describe, expect, it } from 'vitest';
import { FirebaseAuthService } from '../auth/authService.js';
import { canShareTeacherGeneratedContent } from '../ownership-service.js';

describe('services.failureModes', () => {
  it('fails fast when firebase auth config is missing', () => {
    const oldApiKey = process.env.COURSEFORGE_FIREBASE_API_KEY;
    const oldAuthDomain = process.env.COURSEFORGE_FIREBASE_AUTH_DOMAIN;
    const oldProjectId = process.env.COURSEFORGE_FIREBASE_PROJECT_ID;
    const oldAppId = process.env.COURSEFORGE_FIREBASE_APP_ID;

    delete process.env.COURSEFORGE_FIREBASE_API_KEY;
    delete process.env.COURSEFORGE_FIREBASE_AUTH_DOMAIN;
    delete process.env.COURSEFORGE_FIREBASE_PROJECT_ID;
    delete process.env.COURSEFORGE_FIREBASE_APP_ID;

    expect(() => new FirebaseAuthService()).toThrow('Missing Firebase auth configuration for CourseForge Cloud.');

    process.env.COURSEFORGE_FIREBASE_API_KEY = oldApiKey;
    process.env.COURSEFORGE_FIREBASE_AUTH_DOMAIN = oldAuthDomain;
    process.env.COURSEFORGE_FIREBASE_PROJECT_ID = oldProjectId;
    process.env.COURSEFORGE_FIREBASE_APP_ID = oldAppId;
  });

  it('denies sharing when copyrighted pages are present', () => {
    expect(
      canShareTeacherGeneratedContent({
        isSameEditionOwner: true,
        includesTeacherCreatedContent: true,
        includesStructuralMetadataOnly: false,
        includesCopyrightedMaterial: true
      })
    ).toBe(false);
  });
});
