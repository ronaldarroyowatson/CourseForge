import { CosmosClient, type Container } from "@azure/cosmos";

const AZURE_COSMOS_CONNECTION_STRING = "AZURE_COSMOS_CONNECTION_STRING";
const COURSEFORGE_DATABASE_ID = "courseforge";
const TEXTBOOKS_CONTAINER_ID = "textbooks";
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

interface AzureContainerCache {
  container: Container;
}

type AzureStoredRecord<T = unknown> = {
  id: string;
  collection: string;
  payload: T;
  updatedAt: string;
};

let cosmosClient: CosmosClient | null = null;
let containerCache: AzureContainerCache | null = null;

function getConnectionString(): string {
  const processEnv = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;

  const connectionString = processEnv?.[AZURE_COSMOS_CONNECTION_STRING];
  if (!connectionString || connectionString.trim().length === 0) {
    throw new Error(
      `${AZURE_COSMOS_CONNECTION_STRING} is not configured. Add it to your .env file before using Azure sync.`
    );
  }

  return connectionString;
}

function getClient(): CosmosClient {
  if (!cosmosClient) {
    cosmosClient = new CosmosClient({ connectionString: getConnectionString() });
  }

  return cosmosClient;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRY_ATTEMPTS) {
        break;
      }

      const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(`[azure-sync] ${operationName} failed on attempt ${attempt}; retrying in ${delayMs}ms`, error);
      await delay(delayMs);
    }
  }

  console.error(`[azure-sync] ${operationName} failed after ${MAX_RETRY_ATTEMPTS} attempts`, lastError);
  throw lastError;
}

export async function getCourseforgeTextbooksContainer(): Promise<Container> {
  if (containerCache) {
    return containerCache.container;
  }

  const client = getClient();

  const { database } = await withRetry("database.createIfNotExists", async () =>
    client.databases.createIfNotExists({ id: COURSEFORGE_DATABASE_ID })
  );

  const { container } = await withRetry("container.createIfNotExists", async () =>
    database.containers.createIfNotExists({
      id: TEXTBOOKS_CONTAINER_ID,
      partitionKey: { paths: ["/collection"] },
    })
  );

  containerCache = { container };
  return container;
}

export async function writeToAzure(collection: string, id: string, data: unknown): Promise<void> {
  try {
    const container = await getCourseforgeTextbooksContainer();
    const record: AzureStoredRecord = {
      id,
      collection,
      payload: data,
      updatedAt: new Date().toISOString(),
    };

    await withRetry("container.items.upsert", async () => {
      await container.items.upsert(record);
    });

    console.info(`[azure-sync] write succeeded for ${collection}/${id}`);
  } catch (error) {
    console.error(`[azure-sync] write failed for ${collection}/${id}`, error);
    throw error;
  }
}

export async function readFromAzure(collection: string, id: string): Promise<unknown | null> {
  try {
    const container = await getCourseforgeTextbooksContainer();
    const querySpec = {
      query: "SELECT TOP 1 * FROM c WHERE c.collection = @collection AND c.id = @id",
      parameters: [
        { name: "@collection", value: collection },
        { name: "@id", value: id },
      ],
    };

    const { resources } = await withRetry("container.items.query(read)", async () =>
      container.items.query<AzureStoredRecord>(querySpec).fetchAll()
    );

    return resources[0]?.payload ?? null;
  } catch (error) {
    console.error(`[azure-sync] read failed for ${collection}/${id}`, error);
    throw error;
  }
}

export async function listFromAzure(collection: string): Promise<unknown[]> {
  try {
    const container = await getCourseforgeTextbooksContainer();
    const querySpec = {
      query: "SELECT * FROM c WHERE c.collection = @collection",
      parameters: [{ name: "@collection", value: collection }],
    };

    const { resources } = await withRetry("container.items.query(list)", async () =>
      container.items.query<AzureStoredRecord>(querySpec).fetchAll()
    );

    return resources.map((entry) => entry.payload);
  } catch (error) {
    console.error(`[azure-sync] list failed for ${collection}`, error);
    throw error;
  }
}
