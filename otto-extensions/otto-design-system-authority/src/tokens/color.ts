import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";

const colorScale = {
  neutral: {
    0: "#ffffff",
    50: "#f8fafc",
    100: "#f1f5f9",
    200: "#e2e8f0",
    300: "#cbd5e1",
    400: "#94a3b8",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    800: "#1e293b",
    900: "#0f172a"
  },
  blue: {
    500: "#2563eb",
    600: "#1d4ed8"
  },
  green: {
    500: "#16a34a",
    600: "#15803d"
  },
  amber: {
    500: "#f59e0b",
    600: "#d97706"
  },
  red: {
    500: "#dc2626",
    600: "#b91c1c"
  }
} as const;

export const colorTokens = deepFreeze({
  id: "otto.design.tokens.color",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    scale: colorScale,
    semantic: {
      primary: { background: colorScale.blue[600], foreground: colorScale.neutral[0], border: colorScale.blue[600] },
      secondary: { background: colorScale.neutral[100], foreground: colorScale.neutral[800], border: colorScale.neutral[300] },
      destructive: { background: colorScale.red[600], foreground: colorScale.neutral[0], border: colorScale.red[600] },
      quiet: { background: "transparent", foreground: colorScale.neutral[700], border: "transparent" },
      ghost: { background: colorScale.neutral[50], foreground: colorScale.neutral[800], border: colorScale.neutral[200] },
      info: { background: colorScale.blue[500], foreground: colorScale.neutral[0], border: colorScale.blue[500] },
      success: { background: colorScale.green[600], foreground: colorScale.neutral[0], border: colorScale.green[600] },
      warning: { background: colorScale.amber[600], foreground: colorScale.neutral[900], border: colorScale.amber[600] },
      error: { background: colorScale.red[500], foreground: colorScale.neutral[0], border: colorScale.red[500] }
    }
  }
} as const);
