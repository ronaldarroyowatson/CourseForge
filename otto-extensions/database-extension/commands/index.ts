import { createTextbook } from './createTextbook.js';
import { createUser } from './createUser.js';
import { getSharedContent } from './getSharedContent.js';
import { getTeacherContent } from './getTeacherContent.js';
import { getTextbook } from './getTextbook.js';
import { getTextbooksByOwner } from './getTextbooksByOwner.js';
import { getUser } from './getUser.js';
import { updateSharedContent } from './updateSharedContent.js';
import { updateTeacherContent } from './updateTeacherContent.js';
import { updateTextbook } from './updateTextbook.js';
import { updateUserLoginTimestamp } from './updateUserLoginTimestamp.js';
import { verifyOwnership } from './verifyOwnership.js';
import type { DbCommandHandler, DbCommandName } from './command-types.js';

export const commandHandlers: { [TCommand in DbCommandName]: DbCommandHandler<TCommand> } = {
  getUser,
  createUser,
  updateUserLoginTimestamp,
  getTextbook,
  getTextbooksByOwner,
  createTextbook,
  updateTextbook,
  verifyOwnership,
  getTeacherContent,
  updateTeacherContent,
  getSharedContent,
  updateSharedContent
};

export type { DbCommandName, DbCommandPayloads, DbCommandResults } from './command-types.js';
