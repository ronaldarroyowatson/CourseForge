import type { DbCommandHandler } from './command-types.js';

export const getUser: DbCommandHandler<'getUser'> = async (provider, payload) => {
  return provider.getDocument('users', payload.uid);
};
