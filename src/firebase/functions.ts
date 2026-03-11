import { getFunctions } from "firebase/functions";

import { firebaseApp } from "./firebaseApp";

export const functionsClient = getFunctions(firebaseApp);
