import type React from 'react';
import {
  behaviorRules,
  componentPrimitives,
  designTokens,
  layoutRules,
  motionRules,
  reactWrappers,
  stateMachines,
  traceOverlayRules,
  type ComponentOverride,
  type SemanticVariant
} from '../../otto-extensions/otto-design-system-authority/src/index.js';

type PrimitiveName = keyof typeof componentPrimitives;

export type AuthorityVariant = SemanticVariant;
export type AuthorityLifecycleState = (typeof stateMachines.lifecycle.config.states)[number];

export const authorityTokens = designTokens;
export const authorityBehaviorRules = behaviorRules;
export const authorityLayoutRules = layoutRules;
export const authorityMotionRules = motionRules;
export const authorityStateMachines = stateMachines;
export const authorityDebugRules = traceOverlayRules;

export function resolvePrimitiveStyle(
  primitiveName: PrimitiveName,
  variant: AuthorityVariant,
  override?: ComponentOverride,
  interactive = false
): React.CSSProperties {
  const primitive = componentPrimitives[primitiveName];
  const style = primitive.resolveStyle(variant, override);
  const resolved: React.CSSProperties = {
    background: style.background,
    color: style.foreground,
    border: `1px solid ${style.borderColor}`,
    borderRadius: style.radius,
    minHeight: style.minHeight,
    minWidth: style.minWidth,
    paddingInline: style.paddingInline,
    paddingBlock: style.paddingBlock,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    boxShadow: style.elevation,
    transition: style.transition
  };

  if (interactive) {
    resolved.cursor = 'pointer';
  }

  return resolved;
}

export function resolveReactWrapperProps(
  primitiveName: PrimitiveName,
  variant: AuthorityVariant,
  options?: { loading?: boolean; disabled?: boolean; override?: ComponentOverride }
): ReturnType<(typeof reactWrappers)[PrimitiveName]> {
  return reactWrappers[primitiveName]({
    variant,
    loading: options?.loading,
    disabled: options?.disabled,
    override: options?.override
  });
}

export function stackLayoutStyle(override?: React.CSSProperties): React.CSSProperties {
  const stack = layoutRules.primitives.config.stack;
  return {
    display: stack.display,
    flexDirection: stack.direction,
    gap: stack.gap,
    ...override
  };
}

export function flowLayoutStyle(override?: React.CSSProperties): React.CSSProperties {
  const flow = layoutRules.primitives.config.flow;
  return {
    display: flow.display,
    flexDirection: flow.direction,
    flexWrap: flow.wrap,
    gap: flow.gap,
    ...override
  };
}

export function gridLayoutStyle(columns = 'repeat(auto-fit, minmax(12rem, 1fr))', override?: React.CSSProperties): React.CSSProperties {
  const grid = layoutRules.primitives.config.grid;
  return {
    display: grid.display,
    gap: grid.gap,
    gridTemplateColumns: columns,
    ...override
  };
}

export function headingTextStyle(level: 'section' | 'screen' = 'section'): React.CSSProperties {
  return {
    margin: 0,
    fontFamily: authorityTokens.typography.config.family.heading,
    fontSize: level === 'screen' ? authorityTokens.typography.config.size.xl : authorityTokens.typography.config.size.lg,
    fontWeight: authorityTokens.typography.config.weight.bold,
    lineHeight: authorityTokens.typography.config.lineHeight.tight
  };
}

export function bodyTextStyle(override?: React.CSSProperties): React.CSSProperties {
  return {
    margin: 0,
    fontFamily: authorityTokens.typography.config.family.body,
    fontSize: authorityTokens.typography.config.size.md,
    lineHeight: authorityTokens.typography.config.lineHeight.normal,
    ...override
  };
}

export function subtleTextStyle(override?: React.CSSProperties): React.CSSProperties {
  return {
    margin: 0,
    fontFamily: authorityTokens.typography.config.family.body,
    fontSize: authorityTokens.typography.config.size.sm,
    lineHeight: authorityTokens.typography.config.lineHeight.normal,
    color: authorityTokens.color.config.semantic.secondary.foreground,
    ...override
  };
}

export function interactiveHoverStyle(disabled = false): React.CSSProperties {
  if (disabled) {
    return {
      opacity: behaviorRules.interaction.config.disabled.opacity,
      cursor: behaviorRules.interaction.config.disabled.cursor
    };
  }

  return {
    transform: `translateY(${behaviorRules.interaction.config.hover.transformY})`,
    transition: motionRules.transitions.config.interactive
  };
}

export function asyncRegionStyle(isActive: boolean): React.CSSProperties {
  return {
    transition: motionRules.transitions.config.async,
    opacity: isActive ? behaviorRules.async.config.loading.opacity : 1
  };
}

export function debugRegionStyle(region: keyof typeof traceOverlayRules.config.layers): React.CSSProperties {
  if (!traceOverlayRules.config.enabledByDefault) {
    return {};
  }

  return {
    outline: `1px ${traceOverlayRules.config.borderStyle} ${traceOverlayRules.config.layers[region]}`,
    outlineOffset: 1,
    opacity: traceOverlayRules.config.opacity
  };
}
