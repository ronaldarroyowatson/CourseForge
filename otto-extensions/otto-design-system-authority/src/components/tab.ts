import { createComponentPrimitive } from "./factory.js";
import { designTokens } from "../tokens/index.js";

export const tabPrimitive = createComponentPrimitive(
  "Tab",
  { root: "button", slots: ["label", "badge"] },
  {
    minHeight: "2rem",
    minWidth: "4rem",
    radius: designTokens.radii.config.pill,
    paddingInline: designTokens.spacing.config.lg,
    paddingBlock: designTokens.spacing.config.xs,
    fontSize: designTokens.typography.config.size.sm,
    iconSize: "0.9rem"
  },
  designTokens.elevation.config.none
);
