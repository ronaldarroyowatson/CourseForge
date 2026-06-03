import { captureVisibleChromeTab } from "./platform";

export type DisplayCaptureErrorCode =
  | "api_unavailable"
  | "chooser_cancelled"
  | "permission_denied"
  | "device_unavailable"
  | "no_video_track"
  | "frame_unavailable"
  | "unknown";

export interface DisplayCaptureSupportInfo {
  browser: "chrome" | "edge" | "safari" | "firefox" | "unknown";
  label: string;
  supportLevel: "strong" | "limited" | "unknown";
  guidance: string;
  extensionRecommended: boolean;
}

interface DisplayCaptureErrorShape {
  code: DisplayCaptureErrorCode;
  detail: string;
}

class DisplayCaptureError extends Error {
  readonly code: DisplayCaptureErrorCode;

  constructor(input: DisplayCaptureErrorShape) {
    super(input.detail);
    this.name = "DisplayCaptureError";
    this.code = input.code;
  }
}

type MediaTrackLike = Pick<MediaStreamTrack, "stop"> & Partial<Pick<MediaStreamTrack, "getSettings">>;
type MediaStreamLike = {
  getVideoTracks: () => MediaTrackLike[];
  getTracks: () => MediaTrackLike[];
};

interface VideoElementLike {
  srcObject: MediaStreamLike | null;
  muted: boolean;
  autoplay: boolean;
  playsInline: boolean;
  videoWidth: number;
  videoHeight: number;
  style: { cssText: string };
  onloadedmetadata: (() => void) | null;
  onloadeddata: (() => void) | null;
  onerror: (() => void) | null;
  play: () => Promise<void>;
  requestVideoFrameCallback?: (callback: () => void) => number;
}

interface CanvasContextLike {
  drawImage: (image: unknown, dx: number, dy: number, dw: number, dh: number) => void;
}

interface CanvasElementLike {
  width: number;
  height: number;
  getContext: (contextId: "2d") => CanvasContextLike | null;
  toDataURL: (type: string, quality?: number) => string;
}

interface ImageCaptureLike {
  grabFrame: () => Promise<{ width: number; height: number; close?: () => void }>;
}

interface DisplayCaptureDeps {
  captureVisibleChromeTab?: () => Promise<string | null>;
  getDisplayMedia?: () => Promise<MediaStreamLike>;
  createVideoElement?: () => VideoElementLike;
  createCanvasElement?: () => CanvasElementLike;
  appendVideoToDom?: (video: VideoElementLike) => void;
  removeVideoFromDom?: (video: VideoElementLike) => void;
  createImageCapture?: (track: MediaTrackLike) => ImageCaptureLike | null;
  setTimeoutFn?: (callback: () => void, timeoutMs?: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

let persistentDisplayMedia: MediaStreamLike | null = null;

function detectBrowser(): DisplayCaptureSupportInfo["browser"] {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("edg/")) {
    return "edge";
  }

  if (ua.includes("chrome/") && !ua.includes("edg/") && !ua.includes("opr/")) {
    return "chrome";
  }

  if (ua.includes("safari/") && !ua.includes("chrome/") && !ua.includes("chromium/")) {
    return "safari";
  }

  if (ua.includes("firefox/")) {
    return "firefox";
  }

  return "unknown";
}

export function getDisplayCaptureSupportInfo(): DisplayCaptureSupportInfo {
  const browser = detectBrowser();

  if (browser === "chrome" || browser === "edge") {
    return {
      browser,
      label: browser === "chrome" ? "Google Chrome" : "Microsoft Edge",
      supportLevel: "strong",
      guidance: "Best support for screen/window capture. If denied, open macOS System Settings > Privacy & Security > Screen Recording and allow this browser, then retry.",
      extensionRecommended: false,
    };
  }

  if (browser === "safari") {
    return {
      browser,
      label: "Safari",
      supportLevel: "limited",
      guidance: "Supported for basic screen/window capture, but chooser behavior can be stricter. Chrome or Edge is recommended for capture-heavy workflows.",
      extensionRecommended: false,
    };
  }

  if (browser === "firefox") {
    return {
      browser,
      label: "Firefox",
      supportLevel: "limited",
      guidance: "Basic capture may work, but UI flow is tuned for Chromium browsers. Chrome or Edge is recommended.",
      extensionRecommended: false,
    };
  }

  return {
    browser,
    label: "Unknown Browser",
    supportLevel: "unknown",
    guidance: "Capture support is unknown in this browser. If capture fails, use Chrome or Edge.",
    extensionRecommended: false,
  };
}

function createDisplayCaptureError(input: DisplayCaptureErrorShape): DisplayCaptureError {
  return new DisplayCaptureError(input);
}

export function normalizeDisplayCaptureError(error: unknown): {
  code: DisplayCaptureErrorCode;
  message: string;
  browser: DisplayCaptureSupportInfo["label"];
} {
  const support = getDisplayCaptureSupportInfo();
  if (error instanceof DisplayCaptureError) {
    return {
      code: error.code,
      message: error.message,
      browser: support.label,
    };
  }

  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return {
        code: "permission_denied",
        message: "Screen capture permission was denied. In macOS, allow Screen Recording for your browser and retry.",
        browser: support.label,
      };
    }

    if (error.name === "AbortError") {
      return {
        code: "chooser_cancelled",
        message: "Screen capture was canceled before a source was selected.",
        browser: support.label,
      };
    }

    if (error.name === "NotReadableError") {
      return {
        code: "device_unavailable",
        message: "The selected capture source could not be read. Close other sharing sessions and try again.",
        browser: support.label,
      };
    }
  }

  if (error instanceof Error) {
    return {
      code: "unknown",
      message: error.message,
      browser: support.label,
    };
  }

  return {
    code: "unknown",
    message: "Unknown capture error.",
    browser: support.label,
  };
}

function isLiveTrack(track: MediaTrackLike | undefined): boolean {
  if (!track) {
    return false;
  }

  const state = (track as MediaStreamTrack).readyState;
  return state !== "ended";
}

function stopMediaStream(media: MediaStreamLike | null): void {
  if (!media) {
    return;
  }

  media.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // Best effort cleanup only.
    }
  });
}

export function resetDisplayCaptureSession(): void {
  stopMediaStream(persistentDisplayMedia);
  persistentDisplayMedia = null;
}

function getPersistentVideoTrack(media: MediaStreamLike | null): MediaTrackLike | undefined {
  const track = media?.getVideoTracks()[0];
  return isLiveTrack(track) ? track : undefined;
}

function getDefaultDeps(): Required<DisplayCaptureDeps> {
  return {
    captureVisibleChromeTab,
    getDisplayMedia: () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }) as unknown as Promise<MediaStreamLike>,
    createVideoElement: () => {
      const video = document.createElement("video") as HTMLVideoElement;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;";
      return video as unknown as VideoElementLike;
    },
    createCanvasElement: () => document.createElement("canvas") as unknown as CanvasElementLike,
    appendVideoToDom: (video) => {
      if (typeof document !== "undefined") {
        document.body.appendChild(video as unknown as Node);
      }
    },
    removeVideoFromDom: (video) => {
      if (typeof document !== "undefined" && document.body.contains(video as unknown as Node)) {
        document.body.removeChild(video as unknown as Node);
      }
    },
    createImageCapture: (track) => {
      const ImageCaptureCtor = (globalThis as unknown as { ImageCapture?: new (input: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
      if (!ImageCaptureCtor) {
        return null;
      }
      return new ImageCaptureCtor(track as MediaStreamTrack);
    },
    setTimeoutFn: (callback, timeoutMs) => globalThis.setTimeout(callback, timeoutMs),
    clearTimeoutFn: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  };
}

function createCanvasDataUrl(
  source: unknown,
  width: number,
  height: number,
  deps: Required<DisplayCaptureDeps>
): string {
  const canvas = deps.createCanvasElement();
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to initialize capture canvas.");
  }

  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function waitForVideoLoad(video: VideoElementLike, deps: Required<DisplayCaptureDeps>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = deps.setTimeoutFn(() => {
      if (settled) {
        return;
      }
      settled = true;
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onerror = null;
      reject(new Error("Unable to read the shared screen."));
    }, 3000);

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      deps.clearTimeoutFn(timeout);
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onerror = null;
      callback();
    };

    video.onloadedmetadata = () => finish(resolve);
    video.onloadeddata = () => finish(resolve);
    video.onerror = () => finish(() => reject(new Error("Unable to read the shared screen.")));
  });
}

async function waitForRenderableFrame(video: VideoElementLike, deps: Required<DisplayCaptureDeps>): Promise<void> {
  if (typeof video.requestVideoFrameCallback === "function") {
    await new Promise<void>((resolve) => {
      let settled = false;
      const timeout = deps.setTimeoutFn(() => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      }, 250);

      video.requestVideoFrameCallback?.(() => {
        if (settled) {
          return;
        }
        settled = true;
        deps.clearTimeoutFn(timeout);
        resolve();
      });
    });
    return;
  }

  await new Promise<void>((resolve) => {
    deps.setTimeoutFn(() => resolve(), 50);
  });
}

async function tryCaptureViaImageCapture(track: MediaTrackLike, deps: Required<DisplayCaptureDeps>): Promise<string | null> {
  const imageCapture = deps.createImageCapture(track);
  if (!imageCapture) {
    return null;
  }

  try {
    const frame = await imageCapture.grabFrame();
    try {
      return createCanvasDataUrl(frame, frame.width, frame.height, deps);
    } finally {
      frame.close?.();
    }
  } catch {
    return null;
  }
}

export async function captureDisplayFrame(
  input?: { preferChromeTabCapture?: boolean; keepSessionAlive?: boolean },
  overrideDeps?: DisplayCaptureDeps
): Promise<string> {
  const deps = { ...getDefaultDeps(), ...(overrideDeps ?? {}) };

  if (input?.preferChromeTabCapture) {
    const chromeCapture = await deps.captureVisibleChromeTab();
    if (chromeCapture) {
      return chromeCapture;
    }
  }

  if (!overrideDeps?.getDisplayMedia && (typeof navigator === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function")) {
    throw createDisplayCaptureError({
      code: "api_unavailable",
      detail: "This browser does not support screen capture via getDisplayMedia.",
    });
  }

  let media: MediaStreamLike | null = null;
  const keepSessionAlive = input?.keepSessionAlive === true;

  const requestDisplayMedia = async (): Promise<MediaStreamLike> => {
    try {
      return await deps.getDisplayMedia();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw createDisplayCaptureError({
          code: "chooser_cancelled",
          detail: "Screen capture was canceled before selecting a source.",
        });
      }

      if (error instanceof DOMException && error.name === "NotAllowedError") {
        throw createDisplayCaptureError({
          code: "permission_denied",
          detail: "Screen capture permission was denied.",
        });
      }

      if (error instanceof DOMException && error.name === "NotReadableError") {
        throw createDisplayCaptureError({
          code: "device_unavailable",
          detail: "The selected capture source is not readable.",
        });
      }

      throw error;
    }
  };

  if (keepSessionAlive) {
    media = persistentDisplayMedia;
    if (!getPersistentVideoTrack(media)) {
      resetDisplayCaptureSession();
      media = await requestDisplayMedia();
      persistentDisplayMedia = media;
    }
  } else {
    media = await requestDisplayMedia();
  }

  if (!media) {
    throw createDisplayCaptureError({
      code: "frame_unavailable",
      detail: "Capture source could not be initialized.",
    });
  }

  try {
    const videoTrack = media.getVideoTracks()[0] as MediaTrackLike | undefined;
    if (!videoTrack) {
      if (keepSessionAlive) {
        resetDisplayCaptureSession();
      }
      throw createDisplayCaptureError({
        code: "no_video_track",
        detail: "No screen-sharing video track was returned.",
      });
    }

    const imageCaptureResult = await tryCaptureViaImageCapture(videoTrack, deps);
    if (imageCaptureResult) {
      return imageCaptureResult;
    }

    const video = deps.createVideoElement();
    video.srcObject = media;
    deps.appendVideoToDom(video);

    try {
      await waitForVideoLoad(video, deps);
      try {
        await video.play();
      } catch {
        // Some browsers can still expose a renderable frame even when play() rejects.
      }
      await waitForRenderableFrame(video, deps);

      const trackSettings = videoTrack.getSettings?.();
      const width = video.videoWidth || trackSettings?.width || 1;
      const height = video.videoHeight || trackSettings?.height || 1;
      if (width < 2 || height < 2) {
        throw createDisplayCaptureError({
          code: "frame_unavailable",
          detail: "Capture source did not provide a usable video frame.",
        });
      }
      return createCanvasDataUrl(video, width, height, deps);
    } finally {
      deps.removeVideoFromDom(video);
    }
  } finally {
    if (!keepSessionAlive) {
      stopMediaStream(media);
    } else if (!getPersistentVideoTrack(media)) {
      resetDisplayCaptureSession();
    }
  }
}