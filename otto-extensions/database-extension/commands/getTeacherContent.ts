import type { DbCommandHandler } from './command-types.js';

export const getTeacherContent: DbCommandHandler<'getTeacherContent'> = async (provider, payload) => {
  const documentId = payload.id ?? payload.textbookId;
  if (!documentId) {
    return null;
  }

  return provider.getDocument('teacherCreatedContent', documentId);
};
