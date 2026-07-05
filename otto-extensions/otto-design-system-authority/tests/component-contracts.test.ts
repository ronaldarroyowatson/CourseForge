import { expect, it } from "vitest";

import { componentPrimitives } from "../src/components/index.js";
import { SEMANTIC_VARIANTS } from "../src/core/types.js";
import { designTokens } from "../src/tokens/index.js";

it("component primitives expose semantic variants and token-based styles", () => {
  const buttonStyle = componentPrimitives.Button.resolveStyle("primary");
  expect(buttonStyle.background).toBe(designTokens.color.config.semantic.primary.background);
  expect(buttonStyle.borderColor).toBe(designTokens.color.config.semantic.primary.border);

  for (const variant of SEMANTIC_VARIANTS) {
    const resolved = componentPrimitives.Card.resolveStyle(variant);
    expect(resolved.transition.length > 0).toBe(true);
  }
});

it("component primitives support minor overrides only", () => {
  const overridden = componentPrimitives.Input.resolveStyle("secondary", {
    minWidth: "20rem",
    radius: "0.9rem"
  });

  expect(overridden.minWidth).toBe("20rem");
  expect(overridden.radius).toBe("0.9rem");
  expect(overridden.background).toBe(designTokens.color.config.semantic.secondary.background);
});

it("rules are immutable at runtime", () => {
  expect(Object.isFrozen(designTokens)).toBe(true);
  expect(Object.isFrozen(componentPrimitives.Button)).toBe(true);
});
