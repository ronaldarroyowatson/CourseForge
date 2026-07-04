import { describe, expect, it } from 'vitest';
import { canShareTeacherGeneratedContent } from '../ownership-service.js';
import { renderCourseForgeUi } from '../render-courseforge-ui.js';

describe('services.basic', () => {
  it('allows sharing for teacher-generated non-copyrighted content', () => {
    expect(
      canShareTeacherGeneratedContent({
        isSameEditionOwner: true,
        includesTeacherCreatedContent: true,
        includesStructuralMetadataOnly: false,
        includesCopyrightedMaterial: false
      })
    ).toBe(true);
  });

  it('renders courseforge ui with indicator metadata', () => {
    const result = renderCourseForgeUi({
      ottoStatus: 'READY',
      courseForgeStatus: 'READY',
      telemetryStatus: 'ON',
      splashStatus: 'ON',
      authStatus: 'READY',
      updateStatus: 'UPDATED',
      loggingStatus: 'ON',
      tracingStatus: 'ON',
      metricsStatus: 'ON',
      currentUser: { uid: 'u', displayName: 'User', avatarLabel: 'US' },
      authLoading: false,
      authErrorMessage: null,
      textbooks: []
    });

    expect(result.indicators.length).toBe(9);
  });
});
