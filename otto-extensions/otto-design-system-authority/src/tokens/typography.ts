import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";

export const typographyTokens = deepFreeze({
  id: "otto.design.tokens.typography",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    family: {
      body: '"Source Sans 3", "Segoe UI", sans-serif',
      heading: '"Merriweather Sans", "Segoe UI", sans-serif',
      mono: '"JetBrains Mono", "SFMono-Regular", monospace'
    },
    size: {
      xs: "0.75rem",
      sm: "0.875rem",
      md: "1rem",
      lg: "1.125rem",
      xl: "1.25rem"
    },
    weight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700
    },
    lineHeight: {
      tight: 1.15,
      normal: 1.45,
      relaxed: 1.65
    }
  }
} as const);
