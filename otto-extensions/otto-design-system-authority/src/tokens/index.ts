import { deepFreeze } from "../core/freeze.js";
import { colorTokens } from "./color.js";
import { elevationTokens } from "./elevation.js";
import { motionTokens } from "./motion.js";
import { radiiTokens } from "./radii.js";
import { spacingTokens } from "./spacing.js";
import { typographyTokens } from "./typography.js";

export { colorTokens, elevationTokens, motionTokens, radiiTokens, spacingTokens, typographyTokens };

export const designTokens = deepFreeze({
  color: colorTokens,
  spacing: spacingTokens,
  typography: typographyTokens,
  motion: motionTokens,
  elevation: elevationTokens,
  radii: radiiTokens
} as const);
