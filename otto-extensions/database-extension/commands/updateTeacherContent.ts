import type { DbCommandHandler } from './command-types.js';

export const updateTeacherContent: DbCommandHandler<'updateTeacherContent'> = async (provider, payload) => {
  const documentId = payload.id ?? payload.textbookId;
  return provider.setDocument('teacherCreatedContent', documentId, {
    textbookId: payload.textbookId,
    ownerId: payload.ownerId,
    vocabTerms: payload.vocabTerms,
    equations: payload.equations,
    concepts: payload.concepts,
    keyIdeas: payload.keyIdeas,
    createdAt: payload.createdAt ?? payload.updatedAt,
    updatedAt: payload.updatedAt
  });
};
