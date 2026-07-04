import type { ComponentOverride, SemanticVariant } from "../../core/types.js";
import type { ComponentPrimitive } from "../../components/types.js";

export interface ReactPrimitiveProps {
  role?: string;
  style: Record<string, string | number>;
  "aria-busy"?: boolean;
  "aria-disabled"?: boolean;
  "data-variant": SemanticVariant;
  "data-component": string;
}

export interface ReactWrapperOptions {
  variant?: SemanticVariant;
  override?: ComponentOverride;
  loading?: boolean;
  disabled?: boolean;
}

export function createReactPrimitiveProps(
  primitive: ComponentPrimitive,
  options: ReactWrapperOptions = {}
): ReactPrimitiveProps {
  const variant = options.variant ?? "primary";
  const style = primitive.resolveStyle(variant, options.override);

  return {
    role: primitive.structure.root,
    style: {
      background: style.background,
      color: style.foreground,
      borderColor: style.borderColor,
      borderRadius: style.radius,
      minHeight: style.minHeight,
      minWidth: style.minWidth,
      paddingInline: style.paddingInline,
      paddingBlock: style.paddingBlock,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      transition: style.transition,
      boxShadow: style.elevation,
      opacity: options.disabled ? style.disabledOpacity : 1,
      cursor: options.disabled ? style.disabledCursor : "pointer"
    },
    "aria-busy": options.loading || undefined,
    "aria-disabled": options.disabled || undefined,
    "data-variant": variant,
    "data-component": primitive.name
  };
}
