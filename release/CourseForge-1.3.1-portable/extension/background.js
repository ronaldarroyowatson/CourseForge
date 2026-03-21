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
