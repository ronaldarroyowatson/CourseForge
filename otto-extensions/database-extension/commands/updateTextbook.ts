import type { DbCommandHandler } from './command-types.js';

export const updateTextbook: DbCommandHandler<'updateTextbook'> = async (provider, payload) => {
  return provider.updateDocument('textbooks', payload.id, payload.updates);
};
