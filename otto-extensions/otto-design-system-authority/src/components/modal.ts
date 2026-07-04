import { createComponentPrimitive } from "./factory.js";
import { designTokens } from "../tokens/index.js";

export const modalPrimitive = createComponentPrimitive(
  "Modal",
  { root: "dialog", slots: ["overlay", "header", "body", "footer"] },
  {
    minHeight: "12rem",
    minWidth: "20rem",
    radius: designTokens.radii.config.lg,
    paddingInline: designTokens.spacing.config.xl,
    paddingBlock: designTokens.spacing.config.xl,
    fontSize: designTokens.typography.config.size.md,
    iconSize: "1.2rem"
  },
  designTokens.elevation.config.overlay
);
