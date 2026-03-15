import { getStorage } from "firebase/storage";
import { firebaseApp } from "./firebaseApp";

export const firebaseStorage = getStorage(firebaseApp);
