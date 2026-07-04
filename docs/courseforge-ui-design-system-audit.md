# CourseForge UI Audit + Authority-Layer Rewrite

Date: 2026-07-04

## Authority Source
- Otto authority extension now vendored in-repo at `otto-extensions/otto-design-system-authority/`.
- CourseForge UI authority adapter: `courseforge-ui/design-system/authority-layer.ts`.
- CourseForge lifecycle-state hook backed by authority state machine: `courseforge-ui/design-system/use-authority-lifecycle.ts`.

## Audit Scope
- `courseforge-ui/**/*.tsx`
- `courseforge-ui/components/common.tsx`
- `courseforge-ui/screens/auth/AuthScreen.tsx`
- `courseforge-ui/CourseForgeCloudApp.tsx`
- `courseforge-ui/splash/SplashScreen.tsx`
- `courseforge-ui/workspace/WorkspaceScreen.tsx`
- `courseforge-ui/textbook-create/TextbookCreateScreen.tsx`
- `courseforge-ui/textbook-resume/TextbookResumeScreen.tsx`
- `courseforge-ui/textbook-completed/TextbookCompletedScreen.tsx`

## Violations Found (Before Rewrite)
1. Local cards/components in app code
- `ScreenCard`, `PrimaryButton`, `RuleList`, `LogoPlaceholder` defined with local style tokens.

2. Local page-shell/card/panel/button style rules
- Inline border/padding/radius/grid/flex/font/shadow/transition values in all page-level TSX files.

3. Local typography/spacing/color tokens
- Literal `fontSize`, `fontFamily`, `background`, `color`, `padding`, `margin` values.

4. Local motion/interaction definitions
- Local button cursor/transition behavior and local loading surface treatment.

5. Local async/state orchestration in page
- Auth lifecycle state/async loading flow defined directly in page component.

6. Local debug visual logic
- No structured authority debug layer usage.

## Violation -> Authority Primitive Mapping
- Local card sections -> `componentPrimitives.Card` via `resolvePrimitiveStyle('Card', ...)`
- Local panel/containers -> `componentPrimitives.Panel` via `resolvePrimitiveStyle('Panel', ...)`
- Local buttons -> `reactWrappers.Button` via `resolveReactWrapperProps('Button', ...)`
- Local list styling -> `componentPrimitives.List` via `resolvePrimitiveStyle('List', ...)`
- Local layout grid/stack/flow -> `layoutRules.primitives` via `stackLayoutStyle`, `flowLayoutStyle`, `gridLayoutStyle`
- Local color/spacing/typography/elevation/radius -> `designTokens` via `authorityTokens`
- Local interaction/async behavior -> `behaviorRules` + `motionRules` via `interactiveHoverStyle`, `asyncRegionStyle`
- Local page lifecycle state machine -> `stateMachines.lifecycle` via `useAuthorityLifecycleState`
- Local debug overlay styling -> `traceOverlayRules` via `debugRegionStyle`

## Files Rewritten
- `courseforge-ui/components/common.tsx`
- `courseforge-ui/CourseForgeCloudApp.tsx`
- `courseforge-ui/screens/auth/AuthScreen.tsx`
- `courseforge-ui/splash/SplashScreen.tsx`
- `courseforge-ui/workspace/WorkspaceScreen.tsx`
- `courseforge-ui/textbook-create/TextbookCreateScreen.tsx`
- `courseforge-ui/textbook-resume/TextbookResumeScreen.tsx`
- `courseforge-ui/textbook-completed/TextbookCompletedScreen.tsx`
- Added: `courseforge-ui/design-system/authority-layer.ts`
- Added: `courseforge-ui/design-system/use-authority-lifecycle.ts`
- Added authority extension copy: `otto-extensions/otto-design-system-authority/**`

## CSL/API/CLI Constraint Verification
- No API route or CLI generation was added under `courseforge-ui/`.
- Existing command flow remains service-driven (`dbClient.run(...)` and service layer usage).
- UI remains a composition/wiring layer and does not define API or CLI surfaces.

## Final Verification
- TypeScript build: pass (`npm run build`).
- CourseForge UI tests: pass (`npm run test -- courseforge-ui`, 31/31 tests).
- Hardcoded design tokens in page files were replaced with authority token and primitive consumption.
- Remaining `style={{ ... }}` in page files are composed from authority adapter outputs.
