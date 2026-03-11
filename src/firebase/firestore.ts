import { getFirestore, setLogLevel } from "firebase/firestore";
import { firebaseApp } from "./firebaseApp";

// Firestore SDK debug logs help surface denied paths and request context while developing.
if (import.meta.env.DEV && !import.meta.env.VITEST) {
	setLogLevel("debug");
}

export const firestoreDb = getFirestore(firebaseApp);
