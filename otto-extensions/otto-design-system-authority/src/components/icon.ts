import { createComponentPrimitive } from "./factory.js";
import { designTokens } from "../tokens/index.js";

export const iconPrimitive = createComponentPrimitive(
  "Icon",
  { root: "span", slots: ["glyph"] },
  {
    minHeight: "1rem",
    minWidth: "1rem",
    radius: designTokens.radii.config.none,
    paddingInline: designTokens.spacing.config.none,
    paddingBlock: designTokens.spacing.config.none,
    fontSize: designTokens.typography.config.size.md,
    iconSize: "1rem"
  },
  designTokens.elevation.config.none
);
