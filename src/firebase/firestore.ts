import { getFirestore, setLogLevel } from "firebase/firestore";
import { firebaseApp } from "./firebaseApp";

type ViteEnvLike = {
	DEV?: boolean;
	VITEST?: boolean;
};

const viteEnv = (import.meta as ImportMeta & { env?: ViteEnvLike } | undefined)?.env;

// Firestore SDK debug logs help surface denied paths and request context while developing.
if (viteEnv?.DEV && !viteEnv?.VITEST) {
	setLogLevel("debug");
}

export const firestoreDb = getFirestore(firebaseApp);
