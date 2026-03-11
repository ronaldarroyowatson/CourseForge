export const firebaseConfig = {
  apiKey: "AIzaSyCFwFK--Lh-c-PSdz6a6c2F8p3TiYGuXW4",
  authDomain: "courseforge-prod.firebaseapp.com",
  projectId: "courseforge-prod",
  storageBucket: "courseforge-prod.firebasestorage.app",
  messagingSenderId: "598291614670",
  appId: "1:598291614670:web:e4b168c603cff17344799f"
};

export function getFirebaseConfigError(): string | null {
  const PLACEHOLDER_VALUES = new Set([
    "YOUR_",
    "https://YOUR_",
    "PLACEHOLDER"
  ]);

  for (const [key, value] of Object.entries(firebaseConfig)) {
    if (typeof value === "string" && PLACEHOLDER_VALUES.has(value)) {
      return `Firebase config is incomplete: ${key} contains a placeholder value. Please fill in real values from your Firebase Console project settings.`;
    }
  }

  return null;
}