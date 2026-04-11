import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseStorage } from "../../firebase/storage";

const COVER_UPLOAD_TIMEOUT_MS = 15000;

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timerId = window.setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    operation
      .then((value) => {
        window.clearTimeout(timerId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timerId);
        reject(error);
      });
  });
}

/**
 * Upload a File object to Firebase Storage under /textbookCovers/{textbookId}
 * and return the public download URL.
 */
export async function uploadTextbookCoverImage(
  textbookId: string,
  file: File
): Promise<string> {
  const storageRef = ref(firebaseStorage, `textbookCovers/${textbookId}`);
  const snapshot = await withTimeout(
    uploadBytes(storageRef, file, {
      contentType: file.type || "image/jpeg",
    }),
    COVER_UPLOAD_TIMEOUT_MS,
    "Cover image upload"
  );
  return getDownloadURL(snapshot.ref);
}

/**
 * Upload a data-URL (e.g., from a canvas snapshot) to Firebase Storage.
 * Converts the data URL to a Blob before uploading.
 */
export async function uploadTextbookCoverFromDataUrl(
  textbookId: string,
  dataUrl: string
): Promise<string> {
  const blob = dataUrlToBlob(dataUrl);
  const storageRef = ref(firebaseStorage, `textbookCovers/${textbookId}`);
  const snapshot = await withTimeout(
    uploadBytes(storageRef, blob, { contentType: blob.type }),
    COVER_UPLOAD_TIMEOUT_MS,
    "Cover image upload"
  );
  return getDownloadURL(snapshot.ref);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64Data] = dataUrl.split(",");
  const mimeMatch = /data:([^;]+);base64/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const byteString = atob(base64Data);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
