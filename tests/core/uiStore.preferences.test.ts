import { describe, expect, it } from "vitest";

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
});
