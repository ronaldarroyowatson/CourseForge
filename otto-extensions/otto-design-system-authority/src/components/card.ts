import { createComponentPrimitive } from "./factory.js";
import { designTokens } from "../tokens/index.js";

export const cardPrimitive = createComponentPrimitive(
  "Card",
  { root: "section", slots: ["header", "body", "footer"] },
  {
    minHeight: "8rem",
    minWidth: "14rem",
    radius: designTokens.radii.config.lg,
    paddingInline: designTokens.spacing.config.xl,
    paddingBlock: designTokens.spacing.config.lg,
    fontSize: designTokens.typography.config.size.md,
    iconSize: "1.1rem"
  },
  designTokens.elevation.config.raised
);
