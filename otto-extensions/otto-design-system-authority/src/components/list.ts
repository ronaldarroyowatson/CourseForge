import { createComponentPrimitive } from "./factory.js";
import { designTokens } from "../tokens/index.js";

export const listPrimitive = createComponentPrimitive(
  "List",
  { root: "ul", slots: ["item", "itemLeading", "itemContent", "itemTrailing"] },
  {
    minHeight: "6rem",
    minWidth: "12rem",
    radius: designTokens.radii.config.md,
    paddingInline: designTokens.spacing.config.md,
    paddingBlock: designTokens.spacing.config.md,
    fontSize: designTokens.typography.config.size.md,
    iconSize: "1rem"
  },
  designTokens.elevation.config.none
);
