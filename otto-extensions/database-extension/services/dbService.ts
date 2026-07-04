import { commandHandlers, type DbCommandName, type DbCommandPayloads, type DbCommandResults } from '../commands/index.js';
import { CosmosProvider } from '../providers/cosmosProvider.js';
import { FirestoreProvider } from '../providers/firestoreProvider.js';
import { ProviderConnectionError, type DatabaseProvider, type ProviderContext } from '../providers/provider-types.js';

export interface DbServiceOptions {
  strictApiKey?: boolean;
  firestoreContext?: ProviderContext;
  cosmosContext?: ProviderContext;
}

export class DbRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbRuleError';
  }
}

export class DbService {
  private readonly primaryProvider: DatabaseProvider;
  private readonly backupProvider: DatabaseProvider;

  constructor(options: DbServiceOptions = {}) {
    const strictApiKey = options.strictApiKey ?? false;

    const firestoreContext: ProviderContext = {
      apiKey: options.firestoreContext?.apiKey ?? process.env.FIRESTORE_API_KEY,
      endpoint: options.firestoreContext?.endpoint ?? process.env.FIRESTORE_ENDPOINT,
      databaseName: options.firestoreContext?.databaseName ?? process.env.FIRESTORE_DATABASE
    };

    const cosmosContext: ProviderContext = {
      apiKey: options.cosmosContext?.apiKey ?? process.env.COSMOS_API_KEY,
      endpoint: options.cosmosContext?.endpoint ?? process.env.COSMOS_ENDPOINT,
      databaseName: options.cosmosContext?.databaseName ?? process.env.COSMOS_DATABASE
    };

    this.primaryProvider = new FirestoreProvider({ context: firestoreContext, strictApiKey });
    this.backupProvider = new CosmosProvider({ context: cosmosContext, strictApiKey });
  }

  async executeCommand<TCommand extends DbCommandName>(
    commandName: TCommand,
    payload: DbCommandPayloads[TCommand]
  ): Promise<DbCommandResults[TCommand]> {
    enforceRules(commandName, payload);

    const command = commandHandlers[commandName];
    const providers = [this.primaryProvider, this.backupProvider] as const;

    if (isWriteCommand(commandName)) {
      const [primaryProvider, backupProvider] = providers;
      let primaryResult: DbCommandResults[TCommand] | null = null;

      try {
        await primaryProvider.testConnection();
        primaryResult = await command(primaryProvider, payload);
      } catch (error) {
        void toError(error, `Failed command ${commandName} on ${primaryProvider.providerName}`);
      }

      if (!primaryResult) {
        await backupProvider.testConnection();
        return command(backupProvider, payload);
      }

      try {
        await backupProvider.testConnection();
        await command(backupProvider, payload);
      } catch {
        // Backup writes are best-effort and should not block primary success.
      }

      return primaryResult;
    }

    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        await provider.testConnection();
        return await command(provider, payload);
      } catch (error) {
        lastError = toError(error, `Failed command ${commandName} on ${provider.providerName}`);
      }
    }

    throw lastError ?? new ProviderConnectionError('db-service', 'No provider available for command execution.');
  }

  async testConnections(): Promise<{ firestore: boolean; cosmos: boolean }> {
    const firestore = await this.primaryProvider
      .testConnection()
      .then(() => true)
      .catch(() => false);

    const cosmos = await this.backupProvider
      .testConnection()
      .then(() => true)
      .catch(() => false);

    return { firestore, cosmos };
  }
}

export function createDbService(options: DbServiceOptions = {}): DbService {
  return new DbService(options);
}

function enforceRules(commandName: DbCommandName, payload: unknown): void {
  switch (commandName) {
    case 'getUser': {
      const commandPayload = payload as DbCommandPayloads['getUser'];
      assertString(commandPayload.uid, 'getUser.uid');
      break;
    }
    case 'createUser': {
      const commandPayload = payload as DbCommandPayloads['createUser'];
      assertString(commandPayload.uid, 'createUser.uid');
      assertString(commandPayload.email, 'createUser.email');
      assertString(commandPayload.displayName, 'createUser.displayName');
      assertArray(commandPayload.textbooks, 'createUser.textbooks');
      break;
    }
    case 'updateUserLoginTimestamp': {
      const commandPayload = payload as DbCommandPayloads['updateUserLoginTimestamp'];
      assertString(commandPayload.uid, 'updateUserLoginTimestamp.uid');
      assertString(commandPayload.lastLogin, 'updateUserLoginTimestamp.lastLogin');
      break;
    }
    case 'getTextbook': {
      const commandPayload = payload as DbCommandPayloads['getTextbook'];
      assertString(commandPayload.id, 'getTextbook.id');
      break;
    }
    case 'getTextbooksByOwner': {
      const commandPayload = payload as DbCommandPayloads['getTextbooksByOwner'];
      assertString(commandPayload.ownerId, 'getTextbooksByOwner.ownerId');
      break;
    }
    case 'createTextbook': {
      const commandPayload = payload as DbCommandPayloads['createTextbook'];
      assertString(commandPayload.id, 'createTextbook.id');
      assertString(commandPayload.ownerId, 'createTextbook.ownerId');
      assertString(commandPayload.title, 'createTextbook.title');
      assertString(commandPayload.coverImageHash, 'createTextbook.coverImageHash');
      assertAllowedValue(commandPayload.status, ['new', 'in-progress', 'completed'], 'createTextbook.status');
      break;
    }
    case 'updateTextbook': {
      const commandPayload = payload as DbCommandPayloads['updateTextbook'];
      assertString(commandPayload.id, 'updateTextbook.id');
      break;
    }
    case 'verifyOwnership': {
      const commandPayload = payload as DbCommandPayloads['verifyOwnership'];
      assertString(commandPayload.textbookId, 'verifyOwnership.textbookId');
      assertString(commandPayload.ownerId, 'verifyOwnership.ownerId');
      assertString(commandPayload.coverImageHash, 'verifyOwnership.coverImageHash');
      assertOptionalString(commandPayload.verifiedAt, 'verifyOwnership.verifiedAt');
      break;
    }
    case 'getOwnershipRecord': {
      const commandPayload = payload as DbCommandPayloads['getOwnershipRecord'];
      assertString(commandPayload.ownerId, 'getOwnershipRecord.ownerId');
      assertString(commandPayload.textbookId, 'getOwnershipRecord.textbookId');
      break;
    }
    case 'getEditionOwners': {
      const commandPayload = payload as DbCommandPayloads['getEditionOwners'];
      assertString(commandPayload.textbookId, 'getEditionOwners.textbookId');
      assertOptionalNumber(commandPayload.tolerance, 'getEditionOwners.tolerance');
      break;
    }
    case 'getTeacherContent': {
      const commandPayload = payload as DbCommandPayloads['getTeacherContent'];
      assertOptionalString(commandPayload.id, 'getTeacherContent.id');
      assertOptionalString(commandPayload.textbookId, 'getTeacherContent.textbookId');
      if (!commandPayload.id && !commandPayload.textbookId) {
        throw new DbRuleError('getTeacherContent requires id or textbookId.');
      }
      break;
    }
    case 'updateTeacherContent': {
      const commandPayload = payload as DbCommandPayloads['updateTeacherContent'];
      assertString(commandPayload.textbookId, 'updateTeacherContent.textbookId');
      assertString(commandPayload.ownerId, 'updateTeacherContent.ownerId');
      assertArray(commandPayload.vocabTerms, 'updateTeacherContent.vocabTerms');
      assertArray(commandPayload.equations, 'updateTeacherContent.equations');
      assertArray(commandPayload.concepts, 'updateTeacherContent.concepts');
      assertArray(commandPayload.keyIdeas, 'updateTeacherContent.keyIdeas');
      break;
    }
    case 'getSharedContent': {
      const commandPayload = payload as DbCommandPayloads['getSharedContent'];
      assertOptionalString(commandPayload.id, 'getSharedContent.id');
      assertOptionalString(commandPayload.textbookId, 'getSharedContent.textbookId');
      assertString(commandPayload.ownerId, 'getSharedContent.ownerId');
      assertOptionalNumber(commandPayload.tolerance, 'getSharedContent.tolerance');
      if (!commandPayload.id && !commandPayload.textbookId) {
        throw new DbRuleError('getSharedContent requires id or textbookId.');
      }
      break;
    }
    case 'updateSharedContent': {
      const commandPayload = payload as DbCommandPayloads['updateSharedContent'];
      assertString(commandPayload.textbookId, 'updateSharedContent.textbookId');
      assertString(commandPayload.ownerId, 'updateSharedContent.ownerId');
      assertArray(commandPayload.sharedContentRefs, 'updateSharedContent.sharedContentRefs');
      assertOptionalString(commandPayload.createdAt, 'updateSharedContent.createdAt');
      assertOptionalString(commandPayload.updatedAt, 'updateSharedContent.updatedAt');
      break;
    }
    default:
      throw new DbRuleError(`Unknown command ${String(commandName)}`);
  }
}

function assertString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DbRuleError(`${fieldName} must be a non-empty string.`);
  }
}

function assertOptionalString(value: unknown, fieldName: string): void {
  if (value === undefined) {
    return;
  }

  assertString(value, fieldName);
}

function assertArray(value: unknown, fieldName: string): void {
  if (!Array.isArray(value)) {
    throw new DbRuleError(`${fieldName} must be an array.`);
  }
}

function assertAllowedValue<TValue extends string>(value: TValue, allowedValues: TValue[], fieldName: string): void {
  if (!allowedValues.includes(value)) {
    throw new DbRuleError(`${fieldName} must be one of: ${allowedValues.join(', ')}.`);
  }
}

function assertOptionalNumber(value: unknown, fieldName: string): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new DbRuleError(`${fieldName} must be a non-negative number.`);
  }
}

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
}

function isWriteCommand(commandName: DbCommandName): boolean {
  return (
    commandName === 'createUser' ||
    commandName === 'updateUserLoginTimestamp' ||
    commandName === 'createTextbook' ||
    commandName === 'updateTextbook' ||
    commandName === 'verifyOwnership' ||
    commandName === 'updateTeacherContent' ||
    commandName === 'updateSharedContent'
  );
}
