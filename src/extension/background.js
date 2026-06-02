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
          func: async () => {
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
            const PASS_LIMIT = 4;

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
            const startScrollTop = scrollContainer ? scrollContainer.scrollTop : window.scrollY;
            const maxScrollableDistance = scrollContainer
              ? Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
              : Math.max(0, document.documentElement.scrollHeight - viewportHeight);
            const passCount = Math.max(1, Math.min(PASS_LIMIT, Math.floor(maxScrollableDistance / Math.max(120, Math.round(viewportHeight * 0.7))) + 1));
            const nodes = [];
            const seen = new Set();

            const collectCandidates = (passIndex) => {
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

                const absoluteTop = scrollContainer
                  ? rect.top + scrollContainer.scrollTop
                  : rect.top + window.scrollY;
                const key = `${text.toLowerCase()}|${Math.round(rect.left)}|${Math.round(absoluteTop / 8)}`;
                if (seen.has(key)) {
                  continue;
                }
                seen.add(key);

                const role = node.getAttribute("role") || node.tagName.toLowerCase();
                const ariaLevel = Number(node.getAttribute("aria-level"));
                const level = Number.isFinite(ariaLevel) && ariaLevel > 0 ? ariaLevel : undefined;

                nodes.push({
                  id: `${passIndex}-${index}-${Math.round(rect.top)}-${Math.round(rect.left)}`,
                  text,
                  role,
                  level,
                  absoluteTop,
                  xRatio: Math.min(1, Math.max(0, (rect.left + (rect.width / 2)) / viewportWidth)),
                  yRatio: Math.min(1, Math.max(0, (rect.top + (rect.height / 2)) / viewportHeight)),
                  widthRatio: Math.min(1, Math.max(0, rect.width / viewportWidth)),
                  heightRatio: Math.min(1, Math.max(0, rect.height / viewportHeight)),
                });
              }
            };

            for (let pass = 0; pass < passCount; pass += 1) {
              collectCandidates(pass);
              if (pass >= passCount - 1) {
                break;
              }

              const step = Math.max(120, Math.round(viewportHeight * 0.72));
              if (scrollContainer) {
                const nextTop = Math.min(maxScrollableDistance, scrollContainer.scrollTop + step);
                if (nextTop <= scrollContainer.scrollTop + 1) {
                  break;
                }
                scrollContainer.scrollTop = nextTop;
              } else {
                const nextY = Math.min(maxScrollableDistance, window.scrollY + step);
                if (nextY <= window.scrollY + 1) {
                  break;
                }
                window.scrollTo({ top: nextY, left: 0, behavior: "auto" });
              }

              await delay(220);
            }

            if (scrollContainer) {
              scrollContainer.scrollTop = startScrollTop;
            } else {
              window.scrollTo({ top: startScrollTop, left: 0, behavior: "auto" });
            }

            nodes.sort((a, b) => {
              if (a.absoluteTop !== b.absoluteTop) {
                return a.absoluteTop - b.absoluteTop;
              }

              return a.xRatio - b.xRatio;
            });

            return {
              nodes: nodes.slice(0, 220).map((node) => ({
                id: node.id,
                text: node.text,
                role: node.role,
                level: node.level,
                xRatio: node.xRatio,
                yRatio: node.yRatio,
                widthRatio: node.widthRatio,
                heightRatio: node.heightRatio,
              })),
              passCount,
              autoScrollUsed: passCount > 1,
            };
          },
        });

        const result = executed?.[0]?.result;
        const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
        const passCount = Number.isFinite(result?.passCount) ? Number(result.passCount) : 1;
        const autoScrollUsed = Boolean(result?.autoScrollUsed);
        sendResponse({ ok: true, nodes, passCount, autoScrollUsed });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "TOC mapping scan failed." });
      }
    })();

    return true;
  }

  return false;
});
