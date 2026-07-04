import type { DbCommandHandler } from './command-types.js';

export const updateUserLoginTimestamp: DbCommandHandler<'updateUserLoginTimestamp'> = async (provider, payload) => {
  return provider.updateDocument('users', payload.uid, { lastLogin: payload.lastLogin });
};
