import { getApp, getApps, initializeApp } from "firebase/app";
import { firebaseConfig } from "./firebaseConfig";

export const firebaseApp = getApps().length > 0
	? getApp()
	: initializeApp(firebaseConfig);