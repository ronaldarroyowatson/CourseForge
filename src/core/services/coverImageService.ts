import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseStorage } from "../../firebase/storage";
import type { ParsedTextbook } from "../../lib/storage/uploadTextbookBlob";

/**
 * Upload a File object to Firebase Storage under /textbookCovers/{textbookId}
 * and return the public download URL.
 */
export async function uploadTextbookCoverImage(
  textbookId: string,
  file: File
): Promise<string> {
  const storageRef = ref(firebaseStorage, `textbookCovers/${textbookId}`);
  const snapshot = await uploadBytes(storageRef, file, {
    contentType: file.type || "image/jpeg",
  });
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
  const snapshot = await uploadBytes(storageRef, blob, { contentType: blob.type });
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

/**
 * Attempts to recover a cover image for a textbook whose `coverImageUrl` is
 * missing by downloading its full blob (`textbooks/{textbookId}/full.json`),
 * extracting `coverImageBase64`, and re-uploading it to
 * `textbookCovers/{textbookId}`.
 *
 * Returns the new Firebase Storage download URL on success, or `null` when
 * the blob cannot be found or contains no cover image.
 */
export async function extractAndUploadCoverFromBlob(textbookId: string): Promise<string | null> {
  let blobDownloadUrl: string;
  try {
    const blobRef = ref(firebaseStorage, `textbooks/${textbookId}/full.json`);
    blobDownloadUrl = await getDownloadURL(blobRef);
  } catch {
    // Blob does not exist in storage for this textbook.
    return null;
  }

  let parsed: ParsedTextbook;
  try {
    const response = await fetch(blobDownloadUrl);
    if (!response.ok) {
      return null;
    }
    parsed = (await response.json()) as ParsedTextbook;
  } catch {
    return null;
  }

  const { coverImageBase64 } = parsed;
  if (!coverImageBase64) {
    return null;
  }

  // Normalise: accept raw base64 or a full data-URL
  const dataUrl = coverImageBase64.startsWith("data:")
    ? coverImageBase64
    : `data:image/jpeg;base64,${coverImageBase64}`;

  return uploadTextbookCoverFromDataUrl(textbookId, dataUrl);
}
