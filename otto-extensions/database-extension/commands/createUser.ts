import type { DbCommandHandler } from './command-types.js';

export const createUser: DbCommandHandler<'createUser'> = async (provider, payload) => {
  return provider.setDocument('users', payload.uid, payload);
};
