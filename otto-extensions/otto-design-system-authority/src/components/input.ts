import { createComponentPrimitive } from "./factory.js";
import { designTokens } from "../tokens/index.js";

export const inputPrimitive = createComponentPrimitive(
  "Input",
  { root: "input", slots: ["label", "control", "helpText", "errorText"] },
  {
    minHeight: "2.25rem",
    minWidth: "12rem",
    radius: designTokens.radii.config.sm,
    paddingInline: designTokens.spacing.config.md,
    paddingBlock: designTokens.spacing.config.sm,
    fontSize: designTokens.typography.config.size.md,
    iconSize: "0.9rem"
  },
  designTokens.elevation.config.none
);
