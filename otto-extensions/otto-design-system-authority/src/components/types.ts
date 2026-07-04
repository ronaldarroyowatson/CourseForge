import type { ComponentOverride, SemanticVariant } from "../core/types.js";

export type PrimitiveName = "Button" | "Input" | "Card" | "Panel" | "Modal" | "List" | "Tab" | "Icon";

export interface PrimitiveStructure {
  root: string;
  slots: readonly string[];
}

export interface PrimitiveSizing {
  minHeight: string;
  minWidth: string;
  radius: string;
  paddingInline: string;
  paddingBlock: string;
  fontSize: string;
  iconSize: string;
}

export interface ResolvedPrimitiveStyle {
  background: string;
  foreground: string;
  borderColor: string;
  radius: string;
  minHeight: string;
  minWidth: string;
  paddingInline: string;
  paddingBlock: string;
  fontFamily: string;
  fontSize: string;
  transition: string;
  hoverTransformY: string;
  pressTransformY: string;
  disabledOpacity: number;
  disabledCursor: string;
  elevation: string;
  iconSize: string;
}

export interface ComponentPrimitive {
  id: string;
  version: string;
  immutable: true;
  name: PrimitiveName;
  structure: PrimitiveStructure;
  variants: readonly SemanticVariant[];
  stateMachines: readonly string[];
  resolveStyle(variant: SemanticVariant, override?: ComponentOverride): ResolvedPrimitiveStyle;
}
