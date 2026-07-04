import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION, SEMANTIC_VARIANTS, type ComponentOverride, type SemanticVariant } from "../core/types.js";
import { behaviorRules } from "../behaviors/index.js";
import { motionRules } from "../motion/index.js";
import { stateMachines } from "../state/index.js";
import { designTokens } from "../tokens/index.js";
import type { ComponentPrimitive, PrimitiveName, PrimitiveSizing, PrimitiveStructure, ResolvedPrimitiveStyle } from "./types.js";

export function createComponentPrimitive(
  name: PrimitiveName,
  structure: PrimitiveStructure,
  sizing: PrimitiveSizing,
  elevation: string
): ComponentPrimitive {
  const id = `otto.design.component.${name.toLowerCase()}`;

  return deepFreeze({
    id,
    version: RULESET_VERSION,
    immutable: true,
    name,
    structure,
    variants: SEMANTIC_VARIANTS,
    stateMachines: [stateMachines.lifecycle.id, stateMachines.validation.id, stateMachines.save.id],
    resolveStyle(variant: SemanticVariant, override?: ComponentOverride): ResolvedPrimitiveStyle {
      const semantic = designTokens.color.config.semantic[variant];
      return {
        background: semantic.background,
        foreground: semantic.foreground,
        borderColor: semantic.border,
        radius: override?.radius ?? sizing.radius,
        minHeight: override?.minHeight ?? sizing.minHeight,
        minWidth: override?.minWidth ?? sizing.minWidth,
        paddingInline: sizing.paddingInline,
        paddingBlock: sizing.paddingBlock,
        fontFamily: designTokens.typography.config.family.body,
        fontSize: override?.fontSize ?? sizing.fontSize,
        transition: motionRules.transitions.config.interactive,
        hoverTransformY: behaviorRules.interaction.config.hover.transformY,
        pressTransformY: behaviorRules.interaction.config.press.transformY,
        disabledOpacity: behaviorRules.interaction.config.disabled.opacity,
        disabledCursor: behaviorRules.interaction.config.disabled.cursor,
        elevation,
        iconSize: override?.iconSize ?? sizing.iconSize
      };
    }
  } as const);
}
