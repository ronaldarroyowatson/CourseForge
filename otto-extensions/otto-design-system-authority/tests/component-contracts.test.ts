import test from "node:test";
import assert from "node:assert/strict";

import { componentPrimitives } from "../src/components/index.js";
import { SEMANTIC_VARIANTS } from "../src/core/types.js";
import { designTokens } from "../src/tokens/index.js";

test("component primitives expose semantic variants and token-based styles", () => {
  const buttonStyle = componentPrimitives.Button.resolveStyle("primary");
  assert.equal(buttonStyle.background, designTokens.color.config.semantic.primary.background);
  assert.equal(buttonStyle.borderColor, designTokens.color.config.semantic.primary.border);

  for (const variant of SEMANTIC_VARIANTS) {
    const resolved = componentPrimitives.Card.resolveStyle(variant);
    assert.equal(resolved.transition.length > 0, true);
  }
});

test("component primitives support minor overrides only", () => {
  const overridden = componentPrimitives.Input.resolveStyle("secondary", {
    minWidth: "20rem",
    radius: "0.9rem"
  });

  assert.equal(overridden.minWidth, "20rem");
  assert.equal(overridden.radius, "0.9rem");
  assert.equal(overridden.background, designTokens.color.config.semantic.secondary.background);
});

test("rules are immutable at runtime", () => {
  assert.equal(Object.isFrozen(designTokens), true);
  assert.equal(Object.isFrozen(componentPrimitives.Button), true);
});
