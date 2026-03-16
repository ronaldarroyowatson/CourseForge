export function isChromeOSRuntime(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const userAgentData = nav.userAgentData;
  if (userAgentData?.platform && /cros/i.test(userAgentData.platform)) {
    return true;
  }

  return /cros/i.test(navigator.userAgent || "");
}

export function isSmallChromebookViewport(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.innerWidth <= 1366 && window.innerHeight <= 900;
}

export async function captureVisibleChromeTab(): Promise<string | null> {
  const chromeApi = (globalThis as {
    chrome?: {
      tabs?: {
        captureVisibleTab?: (windowId?: number, options?: { format?: string; quality?: number }, callback?: (dataUrl?: string) => void) => void;
      };
      runtime?: {
        lastError?: { message?: string };
      };
    };
  }).chrome;

  if (!chromeApi?.tabs?.captureVisibleTab) {
    return null;
  }

  const captureVisibleTab = chromeApi.tabs.captureVisibleTab;

  return new Promise<string | null>((resolve) => {
    captureVisibleTab(undefined, { format: "jpeg", quality: 92 }, (dataUrl) => {
      const hasError = Boolean(chromeApi.runtime?.lastError);
      if (hasError || typeof dataUrl !== "string" || dataUrl.length === 0) {
        resolve(null);
        return;
      }

      resolve(dataUrl);
    });
  });
}
