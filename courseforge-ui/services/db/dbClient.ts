import { createDbService } from '../../../otto-extensions/database-extension/services/dbService.js';
import type { DbCommandName, DbCommandPayloads, DbCommandResults } from '../../../otto-extensions/database-extension/commands/index.js';
import { loadCourseForgeCloudConfig } from '../cloud-config.js';

const cloudConfig = loadCourseForgeCloudConfig();
const dbService = createDbService({
  firestoreContext: {
    apiKey: cloudConfig.dbExtension.firestore.apiKey,
    endpoint: cloudConfig.dbExtension.firestore.endpoint,
    databaseName: cloudConfig.dbExtension.firestore.databaseName
  },
  cosmosContext: {
    apiKey: cloudConfig.dbExtension.cosmos.apiKey,
    endpoint: cloudConfig.dbExtension.cosmos.endpoint,
    databaseName: cloudConfig.dbExtension.cosmos.databaseName
  }
});

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
