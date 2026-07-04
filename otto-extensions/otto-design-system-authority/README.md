# Otto Design System

Otto Design System is the global Design System Authority Layer for Otto-powered applications, including CourseForge.

This extension is the single source of truth for:
- Design tokens
- Component primitives
- Behavior rules
- State machines
- Layout primitives
- Motion choreography
- Debug overlays
- Semantic variants

## Critical Surface Policy
- This extension does not expose API or CLI surfaces.
- This extension does not implement HTTP handlers, routes, servers, or CLI entrypoints.
- Internal command execution is limited to Otto Command Service Layer usage.

## Folder Contract
- src/tokens/*: color, spacing, typography, motion, elevation, radii
- src/components/*: framework-agnostic primitives
- src/behaviors/*: hover, press, disabled, async, error rules
- src/state/*: loading/validating/saving/error state machines
- src/layout/*: stack, grid, flow, directional, gravity rules
- src/motion/*: enter/exit/press/hover/async choreography and transitions
- src/debug/*: trace overlays
- src/wrappers/react/*: React adapters around primitives
- src/index.ts: aggregate exports

## Consumer Rules
Applications may override only:
- text
- layout composition
- placement
- data binding

Applications may not redefine:
- colors
- spacing
- motion
- component structure
- behaviors
- state machines

## Integration Steps For Consuming Apps
1. Install this package in the consuming workspace.
2. Import primitives or wrappers from src/index.ts exports.
3. Compose app-specific layout and text only.
4. Use Otto command-service driven rescan hooks to refresh MemPalace metadata after rule updates.
5. Do not fork token values into app repositories.

## Example
```ts
import { componentPrimitives, reactWrappers } from "otto-design-system/src/index.js";

const submitButton = componentPrimitives.Button.resolveStyle("primary", { minWidth: "8rem" });
const reactProps = reactWrappers.Button({ variant: "primary", loading: true });
```

## Validation
- npm test
- npm run typecheck
