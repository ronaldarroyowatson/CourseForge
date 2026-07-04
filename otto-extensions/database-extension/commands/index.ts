import { createTextbook } from './createTextbook.js';
import { createUser } from './createUser.js';
import { fetchBlobPayload } from './fetchBlobPayload.js';
import { getEditionOwners } from './getEditionOwners.js';
import { getOwnershipRecord } from './getOwnershipRecord.js';
import { getSharedContent } from './getSharedContent.js';
import { getTeacherContent } from './getTeacherContent.js';
import { getTextbook } from './getTextbook.js';
import { getTextbooksByOwner } from './getTextbooksByOwner.js';
import { getUser } from './getUser.js';
import { searchMetadataDocuments } from './searchMetadataDocuments.js';
import { updateSharedContent } from './updateSharedContent.js';
import { updateTeacherContent } from './updateTeacherContent.js';
import { updateTextbook } from './updateTextbook.js';
import { updateUserLoginTimestamp } from './updateUserLoginTimestamp.js';
import { verifyOwnership } from './verifyOwnership.js';
import { writeMetadataBlob } from './writeMetadataBlob.js';
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
  getOwnershipRecord,
  getEditionOwners,
  getTeacherContent,
  updateTeacherContent,
  getSharedContent,
  updateSharedContent,
  writeMetadataBlob,
  searchMetadataDocuments,
  fetchBlobPayload
};

export type { DbCommandName, DbCommandPayloads, DbCommandResults } from './command-types.js';
