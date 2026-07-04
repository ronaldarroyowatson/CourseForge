export const RULESET_VERSION = "2026.07.04" as const;

export const SEMANTIC_VARIANTS = [
  "primary",
  "secondary",
  "destructive",
  "quiet",
  "ghost",
  "info",
  "success",
  "warning",
  "error"
] as const;

export type SemanticVariant = (typeof SEMANTIC_VARIANTS)[number];

export interface VersionedRule<TConfig> {
  readonly id: string;
  readonly version: string;
  readonly immutable: true;
  readonly config: Readonly<TConfig>;
}

export interface ComponentOverride {
  readonly radius?: string;
  readonly minHeight?: string;
  readonly minWidth?: string;
  readonly fontSize?: string;
  readonly iconSize?: string;
}
