import { createDbService } from '../../../otto-extensions/database-extension/services/dbService.js';
import type { DbCommandName, DbCommandPayloads, DbCommandResults } from '../../../otto-extensions/database-extension/commands/index.js';

const dbService = createDbService();

export const dbClient = {
  async run<TCommand extends DbCommandName>(
    commandName: TCommand,
    payload: DbCommandPayloads[TCommand]
  ): Promise<DbCommandResults[TCommand]> {
    return dbService.executeCommand(commandName, payload);
  },

  async testConnections(): Promise<{ firestore: boolean; cosmos: boolean }> {
    return dbService.testConnections();
  }
};
