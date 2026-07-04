import type { DbCommandHandler } from './command-types.js';

export const getTextbook: DbCommandHandler<'getTextbook'> = async (provider, payload) => {
  return provider.getDocument('textbooks', payload.id);
};
