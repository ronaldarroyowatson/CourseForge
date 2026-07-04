import { describe, expect, it } from 'vitest';
import { canShareTeacherGeneratedContent } from '../ownership-service.js';
import { renderCourseForgeUi } from '../render-courseforge-ui.js';
import { dbClient } from '../db/dbClient.js';
import { DefaultMetadataBlobService } from '../db/metadataBlobService.js';

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
      ottoLifecycleState: 'OTTO_DONE',
      ottoOverlayVisible: true,
      loggingStatus: 'ON',
      tracingStatus: 'ON',
      metricsStatus: 'ON',
      currentUser: { uid: 'u', displayName: 'User', avatarLabel: 'US' },
      authLoading: false,
      authErrorMessage: null,
      textbooks: []
    });

    expect(result.indicators.length).toBe(10);
  });

  it('auth screen path can reach DB extension connectivity check', async () => {
    const status = await dbClient.testConnections();
    expect(status.firestore).toBe(true);
  });

  it('workspace path supports metadata search and blob fetch roundtrip via DB extension', async () => {
    const service = new DefaultMetadataBlobService();
    const writeResult = await service.writeMetadataBlob({
      ownerId: 'owner-a',
      textbookId: 'tb-meta-1',
      category: 'chapter-summary',
      terms: ['biology', 'cell'],
      contentType: 'application/json',
      encoding: 'utf8',
      payload: JSON.stringify({ summary: 'Cells are the building blocks of life.' })
    });

    const metadataMatches = await service.searchMetadataDocuments({
      ownerId: 'owner-a',
      textbookId: 'tb-meta-1',
      query: 'cell'
    });

    const blob = await service.fetchBlobPayload({
      ownerId: 'owner-a',
      blobId: writeResult.metadata.blobId
    });

    expect(metadataMatches.length).toBeGreaterThan(0);
    expect(blob?.id).toBe(writeResult.blob.id);
  });
});
