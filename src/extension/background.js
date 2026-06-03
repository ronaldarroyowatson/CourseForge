// CourseForge extension background service worker (Manifest V3).
//
// Build and load mapping for "Load unpacked" (Chrome/Edge):
// 1) Build the extension UI so index.html and bundled files are emitted.
// 2) Copy the build output into this extension folder (or point your build output here):
//      src/extension/index.html
//      src/extension/assets/*
//      src/extension/manifest.json
//      src/extension/background.js
// 3) In Chrome/Edge extensions page, choose "Load unpacked" and select src/extension.
//
// Note: this file intentionally keeps runtime logic minimal.
chrome.runtime.onInstalled.addListener(() => {
  // Reserved for future initialization hooks.
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type === "courseforge:toc-autoscroll-step") {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const activeTab = tabs.find((tab) => typeof tab.id === "number");
        if (!activeTab?.id) {
          sendResponse({ ok: false, moved: false, error: "No active tab found for TOC auto-scroll." });
          return;
        }

        const executed = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          world: "MAIN",
          func: async () => {
            const viewportWidth = Math.max(1, window.innerWidth);
            const viewportHeight = Math.max(1, window.innerHeight);

            const getScrollableNavContainer = () => {
              const candidates = Array.from(document.querySelectorAll("nav,aside,[role='navigation'],[role='tree'],[aria-label*='contents' i],[class*='toc']"));
              for (const element of candidates) {
                const style = window.getComputedStyle(element);
                if (!style || style.display === "none" || style.visibility === "hidden") {
                  continue;
                }

                const canScroll = element.scrollHeight - element.clientHeight > 24;
                const rect = element.getBoundingClientRect();
                const inLeftBand = rect.left <= (viewportWidth * 0.6);
                if (canScroll && inLeftBand) {
                  return element;
                }
              }

              return null;
            };

            const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

            const scrollContainer = getScrollableNavContainer();
            const maxScrollableDistance = scrollContainer
              ? Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
              : Math.max(0, document.documentElement.scrollHeight - viewportHeight);
            const step = Math.max(140, Math.round(viewportHeight * 0.72));

            if (scrollContainer) {
              const startTop = scrollContainer.scrollTop;
              const nextTop = Math.min(maxScrollableDistance, startTop + step);
              if (nextTop <= startTop + 1) {
                return { moved: false, atEnd: true };
              }

              scrollContainer.scrollTop = nextTop;
              await delay(220);
              return { moved: true, atEnd: false };
            }

            const startY = window.scrollY;
            const nextY = Math.min(maxScrollableDistance, startY + step);
            if (nextY <= startY + 1) {
              return { moved: false, atEnd: true };
            }

            window.scrollTo({ top: nextY, left: 0, behavior: "auto" });
            await delay(220);
            return { moved: true, atEnd: false };
          },
        });

        const result = executed?.[0]?.result;
        sendResponse({
          ok: true,
          moved: Boolean(result?.moved),
          atEnd: Boolean(result?.atEnd),
        });
      } catch (error) {
        sendResponse({ ok: false, moved: false, error: error instanceof Error ? error.message : "TOC auto-scroll failed." });
      }
    })();

    return true;
  }

  return false;
});
