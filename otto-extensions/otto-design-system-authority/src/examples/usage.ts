import { componentPrimitives } from "../components/index.js";
import { layoutRules } from "../layout/index.js";
import { reactWrappers } from "../wrappers/react/index.js";

export const designSystemUsageExample = {
  layout: {
    recipe: layoutRules.primitives.config.stack,
    composition: ["Panel", "List", "Button"]
  },
  primitives: {
    panel: componentPrimitives.Panel.resolveStyle("secondary"),
    list: componentPrimitives.List.resolveStyle("quiet"),
    actionButton: componentPrimitives.Button.resolveStyle("primary", { minWidth: "7rem" })
  },
  reactBindingExample: {
    buttonProps: reactWrappers.Button({ variant: "primary", loading: false }),
    inputProps: reactWrappers.Input({ variant: "secondary" })
  },
  allowedAppOverrides: ["text", "layout composition", "placement", "data binding"],
  blockedAppOverrides: [
    "colors",
    "spacing",
    "motion",
    "component structure",
    "behaviors",
    "state machines"
  ]
} as const;
