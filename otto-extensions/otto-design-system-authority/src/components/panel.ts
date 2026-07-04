import { createComponentPrimitive } from "./factory.js";
import { designTokens } from "../tokens/index.js";

export const panelPrimitive = createComponentPrimitive(
  "Panel",
  { root: "aside", slots: ["title", "body", "actions"] },
  {
    minHeight: "10rem",
    minWidth: "16rem",
    radius: designTokens.radii.config.lg,
    paddingInline: designTokens.spacing.config.xl,
    paddingBlock: designTokens.spacing.config.xl,
    fontSize: designTokens.typography.config.size.md,
    iconSize: "1.1rem"
  },
  designTokens.elevation.config.floating
);
