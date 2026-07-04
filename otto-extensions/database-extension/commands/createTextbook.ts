import type { DbCommandHandler } from './command-types.js';

export const createTextbook: DbCommandHandler<'createTextbook'> = async (provider, payload) => {
  return provider.setDocument('textbooks', payload.id, payload);
};
