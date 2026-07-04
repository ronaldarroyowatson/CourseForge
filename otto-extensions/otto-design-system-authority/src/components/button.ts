import { createComponentPrimitive } from "./factory.js";
import { designTokens } from "../tokens/index.js";

export const buttonPrimitive = createComponentPrimitive(
  "Button",
  { root: "button", slots: ["label", "leadingIcon", "trailingIcon"] },
  {
    minHeight: "2.25rem",
    minWidth: "5rem",
    radius: designTokens.radii.config.md,
    paddingInline: designTokens.spacing.config.lg,
    paddingBlock: designTokens.spacing.config.sm,
    fontSize: designTokens.typography.config.size.md,
    iconSize: "1rem"
  },
  designTokens.elevation.config.raised
);
