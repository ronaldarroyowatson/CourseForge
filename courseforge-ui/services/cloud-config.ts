import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface CourseForgeCloudConfig {
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
    storageBucket: string;
  };
  dbExtension: {
    firestore: {
      apiKey: string;
      endpoint: string;
      databaseName: string;
    };
    cosmos: {
      apiKey: string;
      endpoint: string;
      databaseName: string;
    };
  };
}

export function loadCourseForgeCloudConfig(): CourseForgeCloudConfig {
  const env = getEnv();
  const fileConfig = readOptionalCloudConfigFile();

  const fileFirebase = fileConfig?.firebase;
  const fileDb = fileConfig?.dbExtension;

  const firebaseApiKey =
    env.COURSEFORGE_FIREBASE_PUBLIC_API_KEY ??
    env.COURSEFORGE_FIREBASE_API_KEY ??
    fileFirebase?.apiKey ??
    'SALVAGED_PUBLIC_API_KEY_REQUIRED';

  return {
    firebase: {
      apiKey: firebaseApiKey,
      authDomain: env.COURSEFORGE_FIREBASE_AUTH_DOMAIN ?? fileFirebase?.authDomain ?? 'courseforge-app.firebaseapp.com',
      projectId: env.COURSEFORGE_FIREBASE_PROJECT_ID ?? fileFirebase?.projectId ?? 'courseforge-app',
      appId: env.COURSEFORGE_FIREBASE_APP_ID ?? fileFirebase?.appId ?? 'COURSEFORGE_APP_ID_REQUIRED',
      storageBucket:
        env.COURSEFORGE_FIREBASE_STORAGE_BUCKET ?? fileFirebase?.storageBucket ?? 'courseforge-app.appspot.com'
    },
    dbExtension: {
      firestore: {
        apiKey: env.FIRESTORE_API_KEY ?? firebaseApiKey,
        endpoint: env.FIRESTORE_ENDPOINT ?? fileDb?.firestore?.endpoint ?? 'https://firestore.googleapis.com',
        databaseName: env.FIRESTORE_DATABASE ?? fileDb?.firestore?.databaseName ?? '(default)'
      },
      cosmos: {
        apiKey: env.COSMOS_API_KEY ?? fileDb?.cosmos?.apiKey ?? '',
        endpoint: env.COSMOS_ENDPOINT ?? fileDb?.cosmos?.endpoint ?? '',
        databaseName: env.COSMOS_DATABASE ?? fileDb?.cosmos?.databaseName ?? 'courseforge-backup'
      }
    }
  };
}

function readOptionalCloudConfigFile(): Partial<CourseForgeCloudConfig> | null {
  const cwd = process.cwd();
  const configPath = path.join(cwd, 'deployment', 'courseforge-cloud-config.json');

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as Partial<CourseForgeCloudConfig>;
  } catch {
    return null;
  }
}

function getEnv(): Record<string, string | undefined> {
  const processEnv = typeof process !== 'undefined' ? process.env : undefined;
  const globalEnv = (globalThis as { COURSEFORGE_ENV?: Record<string, string | undefined> }).COURSEFORGE_ENV;

  return {
    ...globalEnv,
    ...processEnv
  };
}