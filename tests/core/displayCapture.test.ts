import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureDisplayFrame,
  getDisplayCaptureSupportInfo,
  normalizeDisplayCaptureError,
  resetDisplayCaptureSession,
} from "../../src/webapp/utils/displayCapture";

afterEach(() => {
  resetDisplayCaptureSession();
});

describe("displayCapture", () => {
  it("falls back to drawing a frame even when video.play rejects", async () => {
    const stop = vi.fn();
    const fakeTrack = {
      stop,
      getSettings: () => ({ width: 1440, height: 900 }),
    };
    const fakeStream = {
      getVideoTracks: () => [fakeTrack],
      getTracks: () => [fakeTrack],
    };

    let loadedMetadataHandler: (() => void) | null = null;
    let loadedDataHandler: (() => void) | null = null;
    const fakeVideo = {
      _srcObject: null as unknown,
      muted: false,
      autoplay: false,
      playsInline: false,
      videoWidth: 1280,
      videoHeight: 720,
      style: { cssText: "" },
      onloadedmetadata: null as (() => void) | null,
      onloadeddata: null as (() => void) | null,
      onerror: null as (() => void) | null,
      set srcObject(value: unknown) {
        this._srcObject = value;
        queueMicrotask(() => {
          loadedMetadataHandler?.();
          loadedDataHandler?.();
        });
      },
      get srcObject() {
        return this._srcObject;
      },
      play: vi.fn(async () => {
        throw new Error("play failed");
      }),
    };

    Object.defineProperty(fakeVideo, "onloadedmetadata", {
      get: () => loadedMetadataHandler,
      set: (value: (() => void) | null) => {
        loadedMetadataHandler = value;
      },
    });
    Object.defineProperty(fakeVideo, "onloadeddata", {
      get: () => loadedDataHandler,
      set: (value: (() => void) | null) => {
        loadedDataHandler = value;
      },
    });

    const drawImage = vi.fn();
    const appendVideoToDom = vi.fn();
    const removeVideoFromDom = vi.fn();

    const result = await captureDisplayFrame(undefined, {
      getDisplayMedia: async () => fakeStream,
      createImageCapture: () => null,
      createVideoElement: () => fakeVideo as never,
      createCanvasElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage }),
        toDataURL: () => "data:image/jpeg;base64,captured-frame",
      }),
      appendVideoToDom,
      removeVideoFromDom,
      setTimeoutFn: (callback) => {
        queueMicrotask(() => {
          callback();
        });
        return 1;
      },
      clearTimeoutFn: () => undefined,
    });

    expect(result).toBe("data:image/jpeg;base64,captured-frame");
    expect(fakeVideo.play).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(appendVideoToDom).toHaveBeenCalledTimes(1);
    expect(removeVideoFromDom).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("returns Chrome tab capture immediately when available", async () => {
    const getDisplayMedia = vi.fn(async () => {
      throw new Error("should not be called");
    });

    const result = await captureDisplayFrame({ preferChromeTabCapture: true }, {
      captureVisibleChromeTab: async () => "data:image/jpeg;base64,chrome-tab",
      getDisplayMedia,
    });

    expect(result).toBe("data:image/jpeg;base64,chrome-tab");
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });

  it("reuses a persistent display media session across TOC captures", async () => {
    const stop = vi.fn();
    const fakeTrack = {
      stop,
      readyState: "live",
      getSettings: () => ({ width: 1440, height: 900 }),
    };
    const fakeStream = {
      getVideoTracks: () => [fakeTrack],
      getTracks: () => [fakeTrack],
    };

    const getDisplayMedia = vi.fn(async () => fakeStream);
    const createImageCapture = vi.fn(() => ({
      grabFrame: async () => ({ width: 1280, height: 720, close: () => undefined }),
    }));

    const first = await captureDisplayFrame({ keepSessionAlive: true }, {
      getDisplayMedia,
      createImageCapture,
      createCanvasElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toDataURL: () => "data:image/jpeg;base64,first",
      }),
    });

    const second = await captureDisplayFrame({ keepSessionAlive: true }, {
      getDisplayMedia,
      createImageCapture,
      createCanvasElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toDataURL: () => "data:image/jpeg;base64,second",
      }),
    });

    expect(first).toBe("data:image/jpeg;base64,first");
    expect(second).toBe("data:image/jpeg;base64,second");
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    resetDisplayCaptureSession();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("normalizes permission-denied capture errors", () => {
    const error = new DOMException("Permission denied", "NotAllowedError");
    const normalized = normalizeDisplayCaptureError(error);

    expect(normalized.code).toBe("permission_denied");
    expect(normalized.message).toContain("Screen capture permission was denied");
  });

  it("returns browser support guidance for Safari", () => {
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    });

    try {
      const support = getDisplayCaptureSupportInfo();
      expect(support.browser).toBe("safari");
      expect(support.supportLevel).toBe("limited");
      expect(support.guidance).toContain("Chrome or Edge");
    } finally {
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: originalUserAgent,
      });
    }
  });
});