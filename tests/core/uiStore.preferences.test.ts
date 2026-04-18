import { describe, expect, it } from "vitest";

import { AUTHORITATIVE_SEMANTIC_PALETTE } from "../../src/core/services/designTokenDebugService";
import { useUIStore } from "../../src/webapp/store/uiStore";

describe("ui store language and accessibility preferences", () => {
  it("updates language instantly", () => {
    useUIStore.getState().setLanguage("de");
    expect(useUIStore.getState().language).toBe("de");
    expect(document.documentElement.getAttribute("lang")).toBe("de");
  });

  it("applies accessibility flags and scaling attributes", () => {
    useUIStore.getState().setAccessibility({
      colorBlindMode: "deuteranopia",
      dyslexiaMode: true,
      dyscalculiaMode: true,
      highContrastMode: true,
      fontScale: 1.2,
      uiScale: 1.1,
    });

    expect(document.documentElement.getAttribute("data-colorblind-mode")).toBe("deuteranopia");
    expect(document.documentElement.getAttribute("data-dyslexia-mode")).toBe("enabled");
    expect(document.documentElement.getAttribute("data-dyscalculia-mode")).toBe("enabled");
    expect(document.documentElement.getAttribute("data-high-contrast")).toBe("enabled");
    expect(document.documentElement.style.getPropertyValue("--cf-font-scale")).toBe("1.2");
    expect(document.documentElement.style.getPropertyValue("--cf-ui-scale")).toBe("1.1");
  });

  it("re-applies the authoritative semantic palette when the theme changes", () => {
    useUIStore.getState().setTheme("dark");

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--cf-accent")).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.MAJOR);
    expect(document.documentElement.style.getPropertyValue("--cf-accent-strong")).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.MINOR);
    expect(document.documentElement.style.getPropertyValue("--cf-success")).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.SUCCESS);
  });
});
