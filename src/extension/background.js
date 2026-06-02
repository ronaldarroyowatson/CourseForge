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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type === "courseforge:tree-map-snapshot") {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const activeTab = tabs.find((tab) => typeof tab.id === "number");
        if (!activeTab?.id) {
          sendResponse({ ok: false, error: "No active tab found for TOC mapping." });
          return;
        }

        const executed = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          world: "MAIN",
          func: () => {
            const viewportWidth = Math.max(1, window.innerWidth);
            const viewportHeight = Math.max(1, window.innerHeight);
            const selector = [
              "[role='treeitem']",
              "[role='button']",
              "button",
              "a",
              "summary",
              "[aria-expanded]",
              "[data-testid*='toc']",
              "[class*='toc']",
            ].join(",");

            const toText = (node) => {
              const aria = node.getAttribute("aria-label") || "";
              const title = node.getAttribute("title") || "";
              const visibleText = (node.innerText || "").replace(/\s+/g, " ").trim();
              return visibleText || aria || title;
            };

            const isVisible = (node, rect) => {
              if (!node || !rect) {
                return false;
              }

              if (rect.width < 8 || rect.height < 8) {
                return false;
              }

              if (rect.bottom < 0 || rect.right < 0 || rect.left > viewportWidth || rect.top > viewportHeight) {
                return false;
              }

              const style = window.getComputedStyle(node);
              if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0) {
                return false;
              }

              return true;
            };

            const nodes = [];
            const seen = new Set();
            const candidates = Array.from(document.querySelectorAll(selector));

            for (let index = 0; index < candidates.length; index += 1) {
              const node = candidates[index];
              const rect = node.getBoundingClientRect();
              if (!isVisible(node, rect)) {
                continue;
              }

              const text = toText(node);
              if (!text || text.length < 2) {
                continue;
              }

              // Focus on left-side navigation region where TOC trees commonly render.
              const inLeftNavBand = rect.left <= (viewportWidth * 0.55);
              if (!inLeftNavBand) {
                continue;
              }

              const key = `${text.toLowerCase()}|${Math.round(rect.left)}|${Math.round(rect.top)}`;
              if (seen.has(key)) {
                continue;
              }
              seen.add(key);

              const role = node.getAttribute("role") || node.tagName.toLowerCase();
              const ariaLevel = Number(node.getAttribute("aria-level"));
              const level = Number.isFinite(ariaLevel) && ariaLevel > 0 ? ariaLevel : undefined;

              nodes.push({
                id: `${index}-${Math.round(rect.top)}-${Math.round(rect.left)}`,
                text,
                role,
                level,
                xRatio: Math.min(1, Math.max(0, (rect.left + (rect.width / 2)) / viewportWidth)),
                yRatio: Math.min(1, Math.max(0, (rect.top + (rect.height / 2)) / viewportHeight)),
                widthRatio: Math.min(1, Math.max(0, rect.width / viewportWidth)),
                heightRatio: Math.min(1, Math.max(0, rect.height / viewportHeight)),
              });
            }

            nodes.sort((a, b) => {
              if (a.yRatio !== b.yRatio) {
                return a.yRatio - b.yRatio;
              }

              return a.xRatio - b.xRatio;
            });

            return nodes.slice(0, 160);
          },
        });

        const nodes = Array.isArray(executed?.[0]?.result) ? executed[0].result : [];
        sendResponse({ ok: true, nodes });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "TOC mapping scan failed." });
      }
    })();

    return true;
  }

  if (message.type !== "courseforge:macro-replay") {
    return false;
  }

  const steps = Array.isArray(message.payload?.steps) ? message.payload.steps : [];
  if (steps.length === 0) {
    sendResponse({ ok: false, error: "No macro steps were provided." });
    return false;
  }

  (async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const activeTab = tabs.find((tab) => typeof tab.id === "number");
      if (!activeTab?.id) {
        sendResponse({ ok: false, error: "No active tab found for replay." });
        return;
      }

      let executed = 0;
      for (const step of steps) {
        const xRatio = Number(step?.xRatio);
        const yRatio = Number(step?.yRatio);
        if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) {
          continue;
        }

        const jitterPx = Math.max(0, Number(step?.jitterPx) || 0);
        const moveSteps = Math.max(4, Number(step?.moveSteps) || 10);
        const pauseMs = Math.max(0, Number(step?.pauseMs) || 0);

        // Dispatch synthetic pointer movement and click inside the active tab viewport.
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          world: "MAIN",
          args: [xRatio, yRatio, jitterPx, moveSteps],
          func: (rawXRatio, rawYRatio, rawJitterPx, rawMoveSteps) => {
            const xRatioSafe = Math.min(1, Math.max(0, Number(rawXRatio) || 0));
            const yRatioSafe = Math.min(1, Math.max(0, Number(rawYRatio) || 0));
            const jitterPx = Math.max(0, Number(rawJitterPx) || 0);
            const moveSteps = Math.max(4, Number(rawMoveSteps) || 10);

            const viewportWidth = Math.max(1, window.innerWidth);
            const viewportHeight = Math.max(1, window.innerHeight);
            const jitterX = jitterPx > 0 ? (Math.random() * jitterPx * 2) - jitterPx : 0;
            const jitterY = jitterPx > 0 ? (Math.random() * jitterPx * 2) - jitterPx : 0;
            const endX = Math.min(viewportWidth - 1, Math.max(0, (xRatioSafe * viewportWidth) + jitterX));
            const endY = Math.min(viewportHeight - 1, Math.max(0, (yRatioSafe * viewportHeight) + jitterY));

            const state = window.__courseforgeMacroState || { x: Math.round(viewportWidth / 2), y: Math.round(viewportHeight / 2) };
            const startX = Number.isFinite(state.x) ? state.x : Math.round(viewportWidth / 2);
            const startY = Number.isFinite(state.y) ? state.y : Math.round(viewportHeight / 2);

            const dispatchMouse = (type, x, y, button = 0) => {
              const target = document.elementFromPoint(x, y) || document.body;
              if (!target) {
                return;
              }

              const event = new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                composed: true,
                clientX: x,
                clientY: y,
                screenX: x,
                screenY: y,
                button,
              });
              target.dispatchEvent(event);
            };

            for (let index = 1; index <= moveSteps; index += 1) {
              const t = index / moveSteps;
              const eased = t * t * (3 - (2 * t));
              const x = Math.round(startX + ((endX - startX) * eased));
              const y = Math.round(startY + ((endY - startY) * eased));
              dispatchMouse("mousemove", x, y, 0);
            }

            dispatchMouse("mouseover", Math.round(endX), Math.round(endY), 0);
            dispatchMouse("mousedown", Math.round(endX), Math.round(endY), 0);
            dispatchMouse("mouseup", Math.round(endX), Math.round(endY), 0);
            dispatchMouse("click", Math.round(endX), Math.round(endY), 0);

            window.__courseforgeMacroState = {
              x: Math.round(endX),
              y: Math.round(endY),
            };
          },
        });

        executed += 1;
        if (pauseMs > 0) {
          await wait(pauseMs);
        }
      }

      sendResponse({ ok: true, executed });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Macro replay failed." });
    }
  })();

  return true;
});
