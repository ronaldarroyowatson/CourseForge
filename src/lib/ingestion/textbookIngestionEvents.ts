/**
 * Textbook Ingestion UI Event Hooks
 *
 * Stub event emitters for the hybrid ingestion pipeline.  These are
 * intentionally thin — they log to the console now and expose a registration
 * API so UI components can subscribe without the pipeline knowing about them.
 *
 * No UI components are modified here (append-only rule).  UI consumers call
 * `onTextbookUploadStart.subscribe(handler)` etc. to receive events.
 */

// ---------------------------------------------------------------------------
// Generic typed event emitter
// ---------------------------------------------------------------------------

type EventHandler<T> = (payload: T) => void;

function createEvent<T>(name: string) {
  const handlers = new Set<EventHandler<T>>();

  const emit = (payload: T): void => {
    console.info(`[CourseForge:IngestionEvent] ${name}`, payload);
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[CourseForge:IngestionEvent] Handler error for "${name}":`, err);
      }
    }
  };

  const subscribe = (handler: EventHandler<T>): (() => void) => {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  };

  return Object.assign(emit, { subscribe, name });
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

export interface UploadStartPayload {
  textbookId: string;
}

export interface UploadCompletePayload {
  textbookId: string;
  storagePath: string;
}

export interface DuplicateDetectedPayload {
  textbookId: string;
  duplicateId: string;
  isWeakerVersion: boolean;
}

export interface UploadAbortedPayload {
  textbookId: string;
  reason: string;
}

export interface IncrementalUpdateAppliedPayload {
  textbookId: string;
  updateCount: number;
}

// ---------------------------------------------------------------------------
// Public event emitters
// ---------------------------------------------------------------------------

/** Fired immediately before the blob upload begins. */
export const onTextbookUploadStart = createEvent<UploadStartPayload>("onTextbookUploadStart");

/** Fired after the blob has been uploaded and metadata written successfully. */
export const onTextbookUploadComplete = createEvent<UploadCompletePayload>("onTextbookUploadComplete");

/** Fired when a duplicate or related textbook is detected in Firestore. */
export const onDuplicateDetected = createEvent<DuplicateDetectedPayload>("onDuplicateDetected");

/** Fired when ingestion is aborted for any reason. */
export const onUploadAborted = createEvent<UploadAbortedPayload>("onUploadAborted");

/** Fired after each successful incremental update batch cycle. */
export const onIncrementalUpdateApplied = createEvent<IncrementalUpdateAppliedPayload>(
  "onIncrementalUpdateApplied",
);
