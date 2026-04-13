import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

import { DesignSystemSettingsCard } from "../../src/webapp/components/settings/DesignSystemSettingsCard";
import { useUIStore } from "../../src/webapp/store/uiStore";

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

  it("updates preview tokens immediately when sliders change", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    expect(screen.getAllByRole("slider").length).toBeGreaterThanOrEqual(4);

    fireEvent.change(screen.getByLabelText(/Gamma:/), { target: { value: "2.35" } });
    fireEvent.change(screen.getByLabelText(/Type ratio:/), { target: { value: "1.333" } });

    await waitFor(() => {
      const state = useUIStore.getState();
      expect(state.designTokenPreferences.gamma).toBe(2.35);
      expect(state.designTokenPreferences.typeRatio).toBe(1.333);
      expect(state.designTokens.color.primary).toHaveLength(9);
    });

    const swatches = screen.getAllByTitle(/Shade /);
    expect(swatches).toHaveLength(9);
  });

  it("reverts changes through keep-changes safety dialog", async () => {
    const before = useUIStore.getState().designTokenPreferences;
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    fireEvent.change(screen.getByLabelText(/Type ratio:/), { target: { value: "1.5" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Keep Changes\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revert Now" }));

    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.typeRatio).toBe(before.typeRatio);
    });
  });

  it("uses the updated card title without the new suffix", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expect(screen.getByText("Design System Controls")).toBeInTheDocument();
    expect(screen.queryByText("Design System Controls (New)")).not.toBeInTheDocument();
  });

  it("collapses when clicking outside the expanded overlay", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.getByText("Collapsed by default. Expand to edit live design controls.")).toBeInTheDocument();
    });
  });

  it("keeps organizer and motion controls grouped before type controls for row alignment", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    const organizerColorsHeading = screen.getByRole("heading", { name: "Organizer Colors" });
    const motionControlsHeading = screen.getByRole("heading", { name: "Motion Controls" });
    const typeRatioHeading = screen.getByRole("heading", { name: "Type Ratio" });

    expect(organizerColorsHeading.compareDocumentPosition(typeRatioHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(motionControlsHeading.compareDocumentPosition(typeRatioHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders email input preview with submit action", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("places spacing scale controls directly below type ratio controls", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    const typeRatioHeading = screen.getByRole("heading", { name: "Type Ratio" });
    const spacingScaleHeading = screen.getByRole("heading", { name: "Spacing Scale" });
    const gammaHeading = screen.getByRole("heading", { name: "Color Curve" });

    expect(typeRatioHeading.compareDocumentPosition(spacingScaleHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(spacingScaleHeading.compareDocumentPosition(gammaHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders motion preview in a right-aligned horizontal cluster", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    const motionLayout = document.querySelector(".cf-motion-preview-layout");
    const motionRow = document.querySelector(".cf-motion-row--right");

    expect(motionLayout).toBeTruthy();
    expect(motionRow).toBeTruthy();
    expect(screen.getByText("Ease In")).toBeInTheDocument();
    expect(screen.getByText("Ease In-Out")).toBeInTheDocument();
    expect(screen.getByText("Ease Out")).toBeInTheDocument();
  });

  it("renders type scale preview as a 2x3 grid ordered from larger to smaller samples", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    const typeGrid = document.querySelector(".cf-type-scale-grid");
    expect(typeGrid).toBeTruthy();
    expect(screen.getByLabelText("type scale preview")).toBeInTheDocument();
    expect(screen.getByText("text-5xl")).toBeInTheDocument();
    expect(screen.getByText("Body text (base)")).toBeInTheDocument();
  });

  it("renders spacing scale preview as a 2x2 grid", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    const spacingGrid = document.querySelector(".cf-spacing-preview");
    expect(spacingGrid).toBeTruthy();
    expect(screen.getByLabelText("spacing scale preview")).toBeInTheDocument();
    expect(screen.getByText("space-1")).toBeInTheDocument();
    expect(screen.getByText("space-4")).toBeInTheDocument();
  });

  it("auto-reverts after keep-changes timeout", async () => {
    vi.useFakeTimers();
    const before = useUIStore.getState().designTokenPreferences;
    render(<DesignSystemSettingsCard userId={null} />);
    expandDesignSystemCard();

    fireEvent.change(screen.getByLabelText(/Type ratio:/), { target: { value: "1.5" } });
    expect(useUIStore.getState().designTokenPreferences.typeRatio).toBe(1.5);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Keep Changes\?/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_500);
    });

    expect(useUIStore.getState().designTokenPreferences.typeRatio).toBe(before.typeRatio);
  });
});

describe("DesignSystemSettingsCard — new DSC controls", () => {
  beforeEach(() => {
    window.localStorage.setItem("courseforge.debugLog.enabled", "false");
    useUIStore.getState().resetDesignTokenPreferences();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders Card Depth — Dual Mode section with four sliders", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    expect(screen.getByRole("heading", { name: "Card Depth — Dual Mode" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Dark Mode Glow Intensity:/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Dark Mode Glow Radius/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Light Mode Shadow Intensity:/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Light Mode Shadow Radius/)).toBeInTheDocument();
  });

  it("updates darkModeGlowIntensity when slider changes", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    fireEvent.change(screen.getByLabelText(/Dark Mode Glow Intensity:/), { target: { value: "8" } });

    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.darkModeGlowIntensity).toBe(8);
    });
  });

  it("updates lightModeShadowRadius when slider changes", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    fireEvent.change(screen.getByLabelText(/Light Mode Shadow Radius/), { target: { value: "24" } });

    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.lightModeShadowRadius).toBe(24);
    });
  });

  it("renders Button Behaviors section with four checkboxes", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    expect(screen.getByRole("heading", { name: "Button Behaviors" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Hover Opacity Effect/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Squish on Press/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Press Depth/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ripple Effect/)).toBeInTheDocument();
  });

  it("updates buttonHoverEnabled when toggled", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    const checkbox = screen.getByLabelText(/Hover Opacity Effect/);
    const before = useUIStore.getState().designTokenPreferences.buttonHoverEnabled;
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.buttonHoverEnabled).toBe(!before);
    });
  });

  it("renders Color Harmony section with mode selector and hue slider", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    expect(screen.getByRole("heading", { name: "Color Harmony" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Harmony Mode/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Base Hue:/)).toBeInTheDocument();
  });

  it("updates colorHarmonyMode when select changes", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    fireEvent.change(screen.getByLabelText(/Harmony Mode/), { target: { value: "triadic" } });

    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.colorHarmonyMode).toBe("triadic");
    });
  });

  it("updates colorHarmonyBaseHue when slider changes", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    fireEvent.change(screen.getByLabelText(/Base Hue:/), { target: { value: "120" } });

    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.colorHarmonyBaseHue).toBe(120);
    });
  });

  it("generated tokens include harmony and button sections", () => {
    const tokens = useUIStore.getState().designTokens;
    expect(tokens.harmony).toBeDefined();
    expect(tokens.harmony.mode).toBeDefined();
    expect(tokens.harmony.accentHue).toBeTypeOf("number");
    expect(tokens.harmony.highlightHue).toBeTypeOf("number");
    expect(tokens.button).toBeDefined();
    expect(tokens.button.hoverEnabled).toBeTypeOf("boolean");
    expect(tokens.button.squishEnabled).toBeTypeOf("boolean");
  });

  it("each motion preview box is independently hoverable", () => {
    render(<DesignSystemSettingsCard userId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    const motionItems = document.querySelectorAll(".cf-motion-box__item");
    expect(motionItems.length).toBe(3);
    // Each item wraps exactly one box
    motionItems.forEach((item) => {
      expect(item.querySelector(".cf-motion-box")).toBeTruthy();
    });
  });

  it("swaps example and controls card order when directional flow toggles", async () => {
    render(<DesignSystemSettingsCard userId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

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
});
