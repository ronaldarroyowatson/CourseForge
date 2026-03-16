# ChromeOS Deployment

## Overview

CourseForge supports Chromebook classrooms through:

- Chrome-optimized extension packaging
- Responsive webapp behavior for Chromebook viewport sizes
- Keyboard-first workflow shortcuts
- Offline-friendly caching for low-connectivity environments

## Implementation Details

### Extension

- Primary manifest remains at `src/extension/manifest.json`.
- Chrome Web Store target manifest is `src/extension/manifest.chrome.json`.
- Chrome build command:

```bash
npm run build:extension:chrome
```

- Chrome-specific permissions included:
  - `activeTab`
  - `scripting`
  - `storage`
  - `tabs`

### Auto Mode on ChromeOS

- Runtime detects ChromeOS by checking `navigator.userAgentData.platform` and fallback UA markers (`CrOS`).
- On ChromeOS extension runtime, Auto Mode attempts `chrome.tabs.captureVisibleTab` before `getDisplayMedia` fallback.
- Compact layout mode is enabled on common Chromebook dimensions (1366x900 and below).

### Webapp

- Service worker registered at startup and served from `src/webapp/public/sw.js`.
- Static and runtime requests are cache-first with network fallback.

## Google Admin Console Deployment

### Push Extension

1. Open Google Admin Console.
2. Go to `Devices -> Chrome -> Apps & extensions -> Users & browsers`.
3. Add app by Chrome Web Store ID or upload package from `dist/extension-chrome` output.
4. Force-install for the target OU.

### Pin Webapp

1. Go to `Devices -> Chrome -> Apps & extensions`.
2. Add a web app entry for your hosted CourseForge URL.
3. Pin the app to shelf for managed student devices.

## ChromeOS Settings Template

Use this starter template for managed browser policy rollout:

- `docs/chromeos-settings.template.json`

## Future Roadmap

- Policy-driven preselection of OCR provider for district-managed deployments.
- Managed extension update channels for staged releases.
- Optional kiosk-mode profile for locked-down lab usage.

## Developer Notes

- Keep extension manifest versions synchronized between standard and Chrome manifests.
- Validate Chrome packaging with `npm run build:extension:chrome` before release tagging.
- Keep Auto Mode fallback paths intact for non-Chrome browsers.
