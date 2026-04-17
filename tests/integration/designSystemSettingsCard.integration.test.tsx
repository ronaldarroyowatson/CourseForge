import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignSystemSettingsCard } from "../../src/webapp/components/settings/DesignSystemSettingsCard";
import { useUIStore } from "../../src/webapp/store/uiStore";
import {
  DEFAULT_DESIGN_TOKEN_PREFERENCES,
  initializeDesignTokenPreferencesOnFirstRun,
  LOCKED_SEMANTIC_PALETTE,
} from "../../src/core/services/designSystemService";

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.min(1, Math.max(0, s));
  const lightness = Math.min(1, Math.max(0, l));

  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (channel: number): string => Math.round(channel * 255).toString(16).padStart(2, "0");
  return `#${toHex(r + m)}${toHex(g + m)}${toHex(b + m)}`;
}

function resetDesignState(): void {
  useUIStore.getState().resetDesignTokenPreferences();
}

function expandDesignSystemCard(): void {
  fireEvent.click(screen.getByRole("button", { name: "Expand" }));
}

describe("DesignSystemSettingsCard", () => {
  beforeEach(() => {
    window.localStorage.setItem("courseforge.debugLog.enabled", "false");
    resetDesignState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts collapsed and collapses on click-off after expansion", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    expect(screen.getByText("Collapsed by default. Expand to edit live design controls.")).toBeInTheDocument();
    expandDesignSystemCard();
    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.getByText("Collapsed by default. Expand to edit live design controls.")).toBeInTheDocument();
    });
  });

  it("renders the upgraded five DSC sections", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    expect(screen.getAllByRole("heading", { name: "Color Harmony" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("heading", { name: "Color Curve (Gamma)" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("heading", { name: "Token Assignment" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("heading", { name: "Card Styling" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("heading", { name: "Component Previews" }).length).toBeGreaterThanOrEqual(1);
  });

  it("updates gamma from the expanded gamma range slider", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    fireEvent.change(screen.getByLabelText(/Color Curve \(Gamma\):/), { target: { value: "2.55" } });

    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.gamma).toBe(2.55);
    });
  });

  it("updates hue and saturation from a single wheel pointer interaction in free mode", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    const wheelCanvas = document.querySelector(".cf-harmony-wheel__canvas") as HTMLCanvasElement | null;
    expect(wheelCanvas).toBeTruthy();
    if (!wheelCanvas) {
      return;
    }

    Object.defineProperty(wheelCanvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        width: 240,
        height: 240,
        top: 0,
        left: 0,
        right: 240,
        bottom: 240,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerDown(wheelCanvas, { pointerId: 1, clientX: 220, clientY: 120 });
    fireEvent.pointerUp(wheelCanvas, { pointerId: 1, clientX: 220, clientY: 120 });

    await waitFor(() => {
      const state = useUIStore.getState().designTokenPreferences;
      expect(state.colorHarmonyBaseHue).not.toBe(212);
      expect(state.colorHarmonySaturation).toBeGreaterThan(60);
    });
  });

  it("keeps saturation fixed when locked mode is selected", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    fireEvent.change(screen.getByLabelText("Saturation Mode"), { target: { value: "locked" } });
    fireEvent.change(screen.getByLabelText(/Saturation Slider/), { target: { value: "35" } });

    const wheelCanvas = document.querySelector(".cf-harmony-wheel__canvas") as HTMLCanvasElement | null;
    expect(wheelCanvas).toBeTruthy();
    if (!wheelCanvas) {
      return;
    }

    Object.defineProperty(wheelCanvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        width: 240,
        height: 240,
        top: 0,
        left: 0,
        right: 240,
        bottom: 240,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerDown(wheelCanvas, { pointerId: 2, clientX: 220, clientY: 120 });
    fireEvent.pointerUp(wheelCanvas, { pointerId: 2, clientX: 220, clientY: 120 });

    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.colorHarmonySaturation).toBe(35);
    });
  });

  it("supports derived brand mode and disables direct brand editing", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    fireEvent.change(screen.getByLabelText("Brand Color Mode"), { target: { value: "derived" } });
    fireEvent.change(screen.getByLabelText("Harmony Mode"), { target: { value: "triadic" } });

    await waitFor(() => {
      const state = useUIStore.getState();
      expect(state.designTokenPreferences.colorHarmonyBrandMode).toBe("derived");
      expect(state.designTokens.harmony.effectiveBrandHue).toBe(state.designTokens.harmony.accentHue);
    });

    expect(screen.getByLabelText("brand harmony color")).toBeDisabled();
    expect(screen.getByLabelText("brand harmony hex")).toBeDisabled();
  });

  it("remaps semantic tokens through the assignment matrix", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    fireEvent.change(screen.getByLabelText("Button Primary assignment"), { target: { value: "major" } });

    await waitFor(() => {
      const state = useUIStore.getState();
      expect(state.designTokenPreferences.semanticAssignments.buttonPrimary).toBe("major");
      expect(state.designTokens.color.assignments.buttonPrimary).toBe("major");
      expect(state.designTokens.component.buttonPrimary.background).toBe(state.designTokens.color.roles.major.shades[4]);
    });
  });

  it("renders the full component preview suite", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    const suite = screen.getByLabelText("component preview suite");

    expect(within(suite).getByText("Background")).toBeInTheDocument();
    expect(within(suite).getByText("Surface")).toBeInTheDocument();
    expect(within(suite).getByRole("button", { name: "primary md" })).toBeInTheDocument();
    expect(within(suite).getByRole("button", { name: "secondary md" })).toBeInTheDocument();
    expect(within(suite).getByRole("button", { name: "ghost md" })).toBeInTheDocument();
    expect(within(suite).getByLabelText("Input field")).toBeInTheDocument();
    expect(within(suite).getByRole("tablist", { name: "Tabs preview" })).toBeInTheDocument();
    expect(within(suite).getByText("Gradient + Shadow + Glow")).toBeInTheDocument();
  });

  it("swaps example and controls card order when directional flow toggles", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    const exampleCard = document.querySelector(".cf-ds-fibonacci-layout__example") as HTMLDivElement | null;
    const controlsCard = document.querySelector(".cf-ds-fibonacci-layout__controls") as HTMLDivElement | null;
    expect(exampleCard).toBeTruthy();
    expect(controlsCard).toBeTruthy();

    expect(exampleCard?.getAttribute("data-slot")).toBe("primary");
    expect(controlsCard?.getAttribute("data-slot")).toBe("secondary");

    fireEvent.click(screen.getByRole("button", { name: "Toggle directional flow" }));

    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.directionalFlow).toBe("right-to-left");
      expect(exampleCard?.getAttribute("data-slot")).toBe("secondary");
      expect(controlsCard?.getAttribute("data-slot")).toBe("primary");
    });
  });

  it("shows helper text on load, fades it, and re-shows on hover", async () => {
    vi.useFakeTimers();
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    const leftHelper = screen.getByText("Click or drag anywhere in the wheel to set hue and saturation");
    const rightHelper = screen.getByText("All harmony markers stay on the same radius unless saturation is locked");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(leftHelper.className.includes("cf-harmony-wheel-helper--visible")).toBe(true);
    expect(rightHelper.className.includes("cf-harmony-wheel-helper--visible")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_500);
    });

    expect(leftHelper.className.includes("cf-harmony-wheel-helper--visible")).toBe(false);
    expect(rightHelper.className.includes("cf-harmony-wheel-helper--visible")).toBe(false);

    const wheelContainer = document.querySelector(".cf-harmony-wheel") as HTMLDivElement | null;
    expect(wheelContainer).toBeTruthy();
    if (!wheelContainer) {
      return;
    }

    fireEvent.pointerEnter(wheelContainer);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(leftHelper.className.includes("cf-harmony-wheel-helper--visible")).toBe(true);
    expect(rightHelper.className.includes("cf-harmony-wheel-helper--visible")).toBe(true);
  });

  it("boots and resets to the same persisted default DSC harmony hex", async () => {
    const expectedDefaultHex = LOCKED_SEMANTIC_PALETTE.major;

    const { unmount } = render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    await waitFor(() => {
      expect(screen.getByLabelText("base harmony hex")).toHaveValue(expectedDefaultHex);
      expect(screen.getByLabelText("brand harmony hex")).toHaveValue(expectedDefaultHex);
    });

    fireEvent.change(screen.getByLabelText(/Base Hue:/), { target: { value: "12" } });
    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.colorHarmonyBaseHue).toBe(12);
      expect(screen.getByLabelText("base harmony hex")).toHaveValue(expectedDefaultHex);
    });

    fireEvent.click(screen.getByRole("button", { name: /Reset to defaults/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("base harmony hex")).toHaveValue(expectedDefaultHex);
      expect(screen.getByLabelText("brand harmony hex")).toHaveValue(expectedDefaultHex);
    });

    expect(document.documentElement.style.getPropertyValue("--cf-ds-harmony-major")).toBe("#2563EB");

    unmount();

    const restarted = initializeDesignTokenPreferencesOnFirstRun();
    const restartedHex = LOCKED_SEMANTIC_PALETTE.major;

    expect(restartedHex).toBe(expectedDefaultHex);
  });

  it("never shows legacy #0c3183 in harmony hex fields", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    await waitFor(() => {
      const baseHex = String(screen.getByLabelText("base harmony hex").getAttribute("value") ?? "");
      const brandHex = String(screen.getByLabelText("brand harmony hex").getAttribute("value") ?? "");
      expect(baseHex.toLowerCase()).not.toBe("#0c3183");
      expect(brandHex.toLowerCase()).not.toBe("#0c3183");
    });
  });

  it("keeps prescribed default hex across harmony permutations and reset", async () => {
    const expectedDefaultHex = LOCKED_SEMANTIC_PALETTE.major;

    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    const harmonyMode = screen.getByLabelText("Harmony Mode");
    const brandMode = screen.getByLabelText("Brand Color Mode");
    const saturationMode = screen.getByLabelText("Saturation Mode");
    const saturationSlider = screen.getByLabelText(/Saturation Slider/);
    const baseHueSlider = screen.getByLabelText(/Base Hue:/);
    const brandHueSlider = screen.getByLabelText(/Brand Hue:/);
    const gammaSlider = screen.getByLabelText(/Color Curve \(Gamma\):/);

    const assertLockedHex = (): void => {
      expect(screen.getByLabelText("base harmony hex")).toHaveValue(expectedDefaultHex);
      expect(screen.getByLabelText("brand harmony hex")).toHaveValue(expectedDefaultHex);
      expect(document.documentElement.style.getPropertyValue("--cf-ds-harmony-major")).toBe(expectedDefaultHex);
    };

    await waitFor(() => {
      assertLockedHex();
    });

    fireEvent.change(saturationMode, { target: { value: "locked" } });
    fireEvent.change(saturationSlider, { target: { value: "0" } });
    fireEvent.change(harmonyMode, { target: { value: "mono" } });
    fireEvent.change(brandMode, { target: { value: "independent" } });
    fireEvent.change(baseHueSlider, { target: { value: "0" } });
    fireEvent.change(brandHueSlider, { target: { value: "0" } });
    fireEvent.change(gammaSlider, { target: { value: "2.6" } });

    await waitFor(() => {
      assertLockedHex();
    });

    fireEvent.change(saturationMode, { target: { value: "free" } });
    fireEvent.change(saturationSlider, { target: { value: "100" } });
    fireEvent.change(harmonyMode, { target: { value: "triadic" } });
    fireEvent.change(brandMode, { target: { value: "derived" } });
    fireEvent.change(baseHueSlider, { target: { value: "320" } });
    fireEvent.change(gammaSlider, { target: { value: "1.8" } });

    await waitFor(() => {
      assertLockedHex();
      expect(useUIStore.getState().designTokenPreferences.colorHarmonyMode).toBe("triadic");
      expect(useUIStore.getState().designTokenPreferences.colorHarmonyBrandMode).toBe("derived");
      expect(useUIStore.getState().designTokenPreferences.colorHarmonySaturationMode).toBe("free");
      expect(useUIStore.getState().designTokenPreferences.colorHarmonyBaseHue).toBe(320);
      expect(useUIStore.getState().designTokenPreferences.gamma).toBe(1.8);
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    await waitFor(() => {
      assertLockedHex();
      expect(useUIStore.getState().designTokenPreferences.colorHarmonyMode).toBe(DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyMode);
      expect(useUIStore.getState().designTokenPreferences.colorHarmonyBrandMode).toBe(DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyBrandMode);
      expect(useUIStore.getState().designTokenPreferences.colorHarmonySaturationMode).toBe(DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonySaturationMode);
      expect(useUIStore.getState().designTokenPreferences.colorHarmonyBaseHue).toBe(DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyBaseHue);
      expect(useUIStore.getState().designTokenPreferences.colorHarmonyBrandHue).toBe(DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyBrandHue);
      expect(useUIStore.getState().designTokenPreferences.colorHarmonySaturation).toBe(DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonySaturation);
      expect(useUIStore.getState().designTokenPreferences.gamma).toBe(DEFAULT_DESIGN_TOKEN_PREFERENCES.gamma);
    });
  });
});