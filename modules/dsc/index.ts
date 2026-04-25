import { DEFAULT_DESIGN_TOKEN_PREFERENCES } from "../../src/core/services/designSystemService";
import { DesignSystemSettingsCard } from "../../src/webapp/components/settings/DesignSystemSettingsCard";
import { FloatingDesignSystemCard } from "../../src/webapp/components/settings/FloatingDesignSystemCard";

const DSC_INSTALLED_KEY = "courseforge.plugins.dsc.installed";

export type DSCComponentRegistry = {
  settingsCard: typeof DesignSystemSettingsCard;
  floatingCard: typeof FloatingDesignSystemCard;
};

export type DSCSettingsSchema = {
  minimal: Array<{ id: string; label: string; type: "select" | "color" }>;
  full: Array<{ id: string; label: string; type: string }>;
};

export function registerDSCModule(): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DSC_INSTALLED_KEY, "true");
  }
}

export function unregisterDSCModule(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(DSC_INSTALLED_KEY);
  }
}

export function getDSCComponents(): DSCComponentRegistry {
  return {
    settingsCard: DesignSystemSettingsCard,
    floatingCard: FloatingDesignSystemCard,
  };
}

export function getDSCSettings(): DSCSettingsSchema {
  return {
    minimal: [
      { id: "theme", label: "Light/Dark mode", type: "select" },
      { id: "baseColor", label: "Base color selector", type: "color" },
    ],
    full: [
      { id: "masonry", label: "Masonry pairing", type: "layout" },
      { id: "floatingCard", label: "Floating controls card", type: "overlay" },
      { id: "examples", label: "Examples + controls", type: "paired" },
    ],
  };
}

export function getDSCDefaults() {
  return {
    preferences: DEFAULT_DESIGN_TOKEN_PREFERENCES,
    floatingLayer: "highest",
    clipping: "viewport",
    pairing: "example-first",
  };
}

export function getDSCExamples(): string[] {
  return [
    "cf-dsc-colors-example",
    "cf-dsc-accent-example",
    "cf-dsc-harmony-example",
    "cf-dsc-colormode-example",
    "cf-dsc-rounding-example",
    "cf-dsc-glow-example",
    "cf-dsc-type-example",
    "cf-dsc-spacing-example",
    "cf-dsc-stroke-example",
    "cf-dsc-motion-example",
    "cf-dsc-components-example",
    "cf-dsc-semantic-example",
  ];
}
