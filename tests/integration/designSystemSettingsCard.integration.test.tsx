import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignSystemSettingsCard } from "../../src/webapp/components/settings/DesignSystemSettingsCard";
import { useUIStore } from "../../src/webapp/store/uiStore";

function resetDesignState(): void {
  useUIStore.getState().resetDesignTokenPreferences();
}

function getRangeFromLabel(labelPattern: RegExp): HTMLInputElement {
  const label = screen.getByText(labelPattern).closest("label");
  if (!label) {
    throw new Error(`Unable to locate label for ${String(labelPattern)}`);
  }

  const slider = label.querySelector("input[type='range']") as HTMLInputElement | null;
  if (!slider) {
    throw new Error(`Unable to locate slider for ${String(labelPattern)}`);
  }

  return slider;
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

    const gammaSlider = getRangeFromLabel(/Gamma:/i);
    const typeSlider = getRangeFromLabel(/Type ratio:/i);

    fireEvent.change(gammaSlider, { target: { value: "2.35" } });
    fireEvent.change(typeSlider, { target: { value: "1.333" } });

    await waitFor(() => {
      const state = useUIStore.getState();
      expect(state.designTokenPreferences.gamma).toBe(2.35);
      expect(state.designTokenPreferences.typeRatio).toBe(1.333);
      expect(state.designTokens.color.primary).toHaveLength(10);
    });

    const swatches = screen.getAllByTitle(/Primary shade/i);
    expect(swatches).toHaveLength(10);
  });

  it("reverts changes through keep-changes safety dialog", async () => {
    const before = useUIStore.getState().designTokenPreferences;
    render(<DesignSystemSettingsCard userId={null} />);

    const typeSlider = getRangeFromLabel(/Type ratio:/i);
    fireEvent.change(typeSlider, { target: { value: "1.5" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Keep Changes\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revert Now" }));

    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.typeRatio).toBe(before.typeRatio);
    });
  });

  it("auto-reverts after keep-changes timeout", async () => {
    vi.useFakeTimers();
    const before = useUIStore.getState().designTokenPreferences;
    render(<DesignSystemSettingsCard userId={null} />);

    const typeSlider = getRangeFromLabel(/Type ratio:/i);
    fireEvent.change(typeSlider, { target: { value: "1.5" } });
    expect(useUIStore.getState().designTokenPreferences.typeRatio).toBe(1.5);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Keep Changes\?/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_500);
    });

    expect(useUIStore.getState().designTokenPreferences.typeRatio).toBe(before.typeRatio);
  });

  it("swaps example and controls card order when directional flow toggles", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    const controlsPanel = screen.getByLabelText("Controls Card");
    const examplePanel = screen.getByLabelText("Example Card");
    expect(examplePanel).toHaveAttribute("data-card-order", "1");
    expect(controlsPanel).toHaveAttribute("data-card-order", "2");

    // The directional flow select is inside a label element
    const flowSelect = screen.getByRole("combobox", { name: /Directional flow/i });
    fireEvent.change(flowSelect, { target: { value: "right-to-left" } });

    await waitFor(() => {
      expect(screen.getByLabelText("Example Card")).toHaveAttribute("data-card-order", "2");
      expect(screen.getByLabelText("Controls Card")).toHaveAttribute("data-card-order", "1");
    });
  });

  it("renders all DSC paired example sections", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    // PairedRow renders example div with id="${sectionId}-example"
    expect(document.getElementById("cf-dsc-colors-example")).toBeInTheDocument();
    expect(document.getElementById("cf-dsc-accent-example")).toBeInTheDocument();
    expect(document.getElementById("cf-dsc-harmony-example")).toBeInTheDocument();
    expect(document.getElementById("cf-dsc-colormode-example")).toBeInTheDocument();
    expect(document.getElementById("cf-dsc-rounding-example")).toBeInTheDocument();
    expect(document.getElementById("cf-dsc-glow-example")).toBeInTheDocument();
    expect(document.getElementById("cf-dsc-type-example")).toBeInTheDocument();
    expect(document.getElementById("cf-dsc-spacing-example")).toBeInTheDocument();
    expect(document.getElementById("cf-dsc-stroke-example")).toBeInTheDocument();
    expect(document.getElementById("cf-dsc-motion-example")).toBeInTheDocument();
    expect(document.getElementById("cf-dsc-components-example")).toBeInTheDocument();
    expect(document.getElementById("cf-dsc-semantic-example")).toBeInTheDocument();
  });

  it("motion boxes have no animation class without hover", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    const enterBox = document.querySelector(".cf-motion-box--enter");
    expect(enterBox).toBeInTheDocument();
    // Animation is triggered by CSS :hover on parent; the row wrapper id has -example suffix
    const motionRow = document.getElementById("cf-dsc-motion-example");
    expect(motionRow).not.toBeNull();
    // The motion row wrapper should have cf-motion-row class on the inner div
    expect(motionRow?.querySelector(".cf-motion-row")).toBeInTheDocument();
  });

  it("glow section renders glow-box and shadow-box", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    expect(document.querySelector(".cf-ds-glow-box")).toBeInTheDocument();
    expect(document.querySelector(".cf-ds-shadow-box")).toBeInTheDocument();
  });

  it("color harmony section renders harmony swatches", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    const swatches = document.querySelectorAll(".cf-ds-harmony-swatch");
    expect(swatches.length).toBeGreaterThanOrEqual(4);
  });

  it("color mode section renders light and dark samples", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    expect(document.querySelector(".cf-ds-mode-sample--light")).toBeInTheDocument();
    expect(document.querySelector(".cf-ds-mode-sample--dark")).toBeInTheDocument();
    expect(screen.getByLabelText("Active mode sample")).toBeInTheDocument();
  });

  it("rounding section renders rounding boxes for active preset", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    expect(document.querySelector(".cf-ds-rounding-box")).toBeInTheDocument();
  });

  it("semantic section renders all four semantic chips", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    // Use class-based query to avoid ambiguity with label text elsewhere in the card
    expect(document.querySelector(".cf-ds-semantic-chip--error")).toBeInTheDocument();
    expect(document.querySelector(".cf-ds-semantic-chip--success")).toBeInTheDocument();
    expect(document.querySelector(".cf-ds-semantic-chip--pending")).toBeInTheDocument();
    expect(document.querySelector(".cf-ds-semantic-chip--new")).toBeInTheDocument();
  });

  it("primary color section removes helper equations and luminance text", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    expect(screen.queryByText(/Equation:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Luminance:/i)).not.toBeInTheDocument();
    expect(screen.getAllByTitle(/Primary shade/i)).toHaveLength(10);
  });

  it("accent and brand controls expose brand, accent, and alt hue sliders", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    expect(screen.getByText(/Brand hue:/i)).toBeInTheDocument();
    expect(screen.getByText(/Accent hue:/i)).toBeInTheDocument();
    expect(screen.getByText(/Alt hue:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Flip direction/i })).toBeInTheDocument();
  });

  it("accent wheel markers and sliders stay bidirectionally bound", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    const brandHueSlider = getRangeFromLabel(/Brand hue:/i);
    fireEvent.change(brandHueSlider, { target: { value: "120" } });

    await waitFor(() => {
      expect(screen.getByLabelText("brand wheel marker")).toHaveAttribute("data-hue", "120");
    });
  });

  it("updates marker coordinates when radial distance and hue change", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    const wheel = screen.getByLabelText("accent derivation wheel") as HTMLDivElement;
    const beforeHue = wheel.style.getPropertyValue("--cf-ds-wheel-brand");
    const beforeDistance = wheel.style.getPropertyValue("--cf-ds-wheel-brand-distance");

    fireEvent.change(getRangeFromLabel(/Brand hue:/i), { target: { value: "359" } });
    fireEvent.change(getRangeFromLabel(/Brand radial distance:/i), { target: { value: "48" } });

    await waitFor(() => {
      const wheelNode = screen.getByLabelText("accent derivation wheel") as HTMLDivElement;
      expect(wheelNode.style.getPropertyValue("--cf-ds-wheel-brand")).not.toBe(beforeHue);
      expect(wheelNode.style.getPropertyValue("--cf-ds-wheel-brand-distance")).not.toBe(beforeDistance);
      expect(wheelNode.style.getPropertyValue("--cf-ds-wheel-brand-distance")).toBe("48%");
      expect(screen.getByLabelText("brand wheel marker")).toHaveAttribute("data-hue", String(useUIStore.getState().designTokenPreferences.brandHue));
    });
  });

  it("accent wheel render key updates on saturation intensity and gamma changes", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    const wheel = screen.getByLabelText("accent derivation wheel");
    const before = wheel.getAttribute("data-render-key");

    fireEvent.change(getRangeFromLabel(/Saturation:/i), { target: { value: "52" } });
    fireEvent.change(getRangeFromLabel(/Glow intensity:/i), { target: { value: "0.9" } });
    fireEvent.change(getRangeFromLabel(/Gamma:/i), { target: { value: "2.3" } });

    await waitFor(() => {
      expect(screen.getByLabelText("accent derivation wheel").getAttribute("data-render-key")).not.toBe(before);
    });
  });

  it("harmony selection anchors on primary hue and updates accent/alt hues", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    fireEvent.change(getRangeFromLabel(/Primary hue:/i), { target: { value: "10" } });

    const harmony = screen.getByRole("combobox", { name: /Color harmony/i });
    fireEvent.change(harmony, { target: { value: "complementary" } });

    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.accentHue).toBe(190);
      expect(useUIStore.getState().designTokenPreferences.altHue).toBe(220);
    });
  });

  it("harmony controls support hex and rgb two-way manual binding", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    const hexInput = screen.getByLabelText(/Brand color hex/i) as HTMLInputElement;
    const beforeRgb = (screen.getByLabelText(/Brand color rgb/i) as HTMLInputElement).value;
    fireEvent.change(hexInput, { target: { value: "#3366cc" } });

    await waitFor(() => {
      const rgbValue = (screen.getByLabelText(/Brand color rgb/i) as HTMLInputElement).value;
      expect(rgbValue).not.toBe(beforeRgb);
      expect(rgbValue).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
    });
  });

  it("recomputes harmony from the edited base hex color", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    fireEvent.change(screen.getByRole("combobox", { name: /Color harmony/i }), { target: { value: "complementary" } });
    fireEvent.change(screen.getByLabelText(/Brand color hex/i), { target: { value: "#ff0000" } });

    await waitFor(() => {
      const state = useUIStore.getState().designTokenPreferences;
      expect(state.primaryHue).toBe(0);
      expect(state.accentHue).toBe(180);
      expect(state.altHue).toBe(210);
      expect(screen.getByLabelText("accent wheel marker")).toHaveAttribute("data-hue", "180");
      expect(screen.getByLabelText("alt wheel marker")).toHaveAttribute("data-hue", "210");
    });
  });

  it("rounding controls use only four rounded buttons and no dropdown", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    expect(screen.queryByRole("combobox", { name: /Rounding preset/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sharp rounding/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Soft rounding/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Round rounding/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pill rounding/i })).toBeInTheDocument();
  });

  it("glow and shadow section removes glow toggle and keeps only sliders", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    expect(screen.queryByRole("checkbox", { name: /Enable glow effect/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Glow radius:/i)).toBeInTheDocument();
    expect(screen.getByText(/Glow intensity:/i)).toBeInTheDocument();
    expect(screen.getByText(/Shadow strength:/i)).toBeInTheDocument();
    expect(screen.getByText(/Shadow distance:/i)).toBeInTheDocument();
    expect(screen.getByText(/Shadow blur:/i)).toBeInTheDocument();
    expect(screen.getByText(/Shadow spread:/i)).toBeInTheDocument();
  });

  it("type and spacing controls remove preset buttons and show snap helper labels", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    expect(screen.queryByRole("button", { name: /Minor Second/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Balanced/i })).not.toBeInTheDocument();

    fireEvent.change(getRangeFromLabel(/Type ratio:/i), { target: { value: "1.25" } });
    fireEvent.change(getRangeFromLabel(/Spacing ratio:/i), { target: { value: "1.5" } });

    await waitFor(() => {
      expect(screen.getByText(/Type preset: Major Third/i)).toBeInTheDocument();
      expect(screen.getByText(/Spacing preset: Authoritative/i)).toBeInTheDocument();
    });
  });

  it("buttons and cards section removes duplicate organizer chips", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    expect(document.querySelector(".cf-example-card__organizers")).not.toBeInTheDocument();
  });

  it("semantic chips follow active rounding preset", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    fireEvent.click(screen.getByRole("button", { name: /Pill rounding/i }));

    await waitFor(() => {
      expect(document.querySelector(".cf-ds-semantic-chip--error")).toHaveAttribute("data-rounding", "pill");
    });
  });

  it("semantic glow uses each semantic color instead of the global glow color", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    fireEvent.change(screen.getByRole("combobox", { name: /Color mode/i }), { target: { value: "dark" } });
    fireEvent.change(screen.getByLabelText(/error color/i), { target: { value: "#ff0000" } });
    fireEvent.change(screen.getByLabelText(/success color/i), { target: { value: "#00ff00" } });

    await waitFor(() => {
      const errorChip = document.querySelector(".cf-ds-semantic-chip--error") as HTMLElement | null;
      const successChip = document.querySelector(".cf-ds-semantic-chip--success") as HTMLElement | null;
      expect(errorChip).not.toBeNull();
      expect(successChip).not.toBeNull();
      expect(errorChip?.getAttribute("data-semantic-glow-color")).toBe("#ff0000");
      expect(successChip?.getAttribute("data-semantic-glow-color")).toBe("#00ff00");
      expect(errorChip?.getAttribute("data-semantic-glow-shadow")).toContain("#ff0000");
      expect(successChip?.getAttribute("data-semantic-glow-shadow")).toContain("#00ff00");
    });
  });

  it("shadow preview stays visible and reactive even under a dark global theme", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<DesignSystemSettingsCard userId={null} />);

    fireEvent.change(getRangeFromLabel(/Shadow strength:/i), { target: { value: "1" } });
    fireEvent.change(getRangeFromLabel(/Shadow distance:/i), { target: { value: "24" } });
    fireEvent.change(getRangeFromLabel(/Shadow blur:/i), { target: { value: "40" } });
    fireEvent.change(getRangeFromLabel(/Shadow spread:/i), { target: { value: "8" } });

    await waitFor(() => {
      const shadowSample = screen.getByLabelText("light mode shadow sample") as HTMLElement;
      const shadowValue = shadowSample.getAttribute("data-shadow-style");
      expect(shadowValue).toContain("0 24px 40px 8px rgba(0, 0, 0");
      expect(shadowValue).not.toBe("none");
    });
  });

  it("renders exactly one semantic button per status", () => {
    render(<DesignSystemSettingsCard userId={null} />);

    expect(document.querySelectorAll(".cf-ds-semantic-chip--new")).toHaveLength(1);
    expect(document.querySelectorAll(".cf-ds-semantic-chip--success")).toHaveLength(1);
    expect(document.querySelectorAll(".cf-ds-semantic-chip--pending")).toHaveLength(1);
    expect(document.querySelectorAll(".cf-ds-semantic-chip--error")).toHaveLength(1);
  });

  // ── Issue 1: Color harmony ↔ wheel desync ─────────────────────────────────
  it("wheel markers re-anchor when primary hue changes under non-system harmony", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    // Set harmony to complementary first
    const harmony = screen.getByRole("combobox", { name: /Color harmony/i });
    fireEvent.change(harmony, { target: { value: "complementary" } });

    // Initial state: primaryHue=212, accent should be 212+180=32 (mod 360)
    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.accentHue).toBe(32);
    });

    // Now change primary hue — accent marker must follow
    fireEvent.change(getRangeFromLabel(/Primary hue:/i), { target: { value: "50" } });

    await waitFor(() => {
      const state = useUIStore.getState().designTokenPreferences;
      // complementary: accent = primary + 180 = 230
      expect(state.accentHue).toBe(230);
      // Wheel marker data-hue must reflect new value
      expect(screen.getByLabelText("accent wheel marker")).toHaveAttribute("data-hue", "230");
    });
  });

  // ── Issue 2: Glow-box should force enabled when system resolves to dark ───
  it("glow-box shows enabled when system color mode resolves to dark with glowEnabled off", async () => {
    // Simulate OS dark mode
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    // Keep colorMode="system" (default) but disable glow explicitly
    act(() => {
      useUIStore.getState().setDesignTokenPreferences({ colorMode: "system", glowEnabled: false });
    });

    render(<DesignSystemSettingsCard userId={null} />);

    await waitFor(() => {
      // When OS is dark and colorMode="system", glow should be forced on even when
      // prefs.glowEnabled=false — effective dark mode must override the pref
      const glowBox = document.querySelector(".cf-ds-glow-box") as HTMLElement;
      expect(glowBox).toBeInTheDocument();
      expect(glowBox).toHaveClass("cf-ds-glow-box--enabled");
      expect(glowBox).not.toHaveClass("cf-ds-glow-box--disabled");
    });
  });

  // ── Issue 3: Semantic chips must use glow surface in system-dark mode ─────
  it("semantic chips use glow class when system color mode resolves to dark", async () => {
    // Simulate OS dark mode
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    // Default colorMode is "system" — OS is dark, so effective mode is "dark"
    render(<DesignSystemSettingsCard userId={null} />);

    await waitFor(() => {
      const errorChip = document.querySelector(".cf-ds-semantic-chip--error") as HTMLElement;
      expect(errorChip).toBeInTheDocument();
      // System-dark must resolve to glow surface, not shadow
      expect(errorChip).toHaveClass("cf-ds-semantic-chip--glow");
      expect(errorChip).not.toHaveClass("cf-ds-semantic-chip--shadow");
    });
  });

  // ── Issue 4: Two card instances stay in sync via shared Zustand store ─────
  it("two rendered card instances both reflect preference changes from the store", async () => {
    const { unmount: unmount1 } = render(<DesignSystemSettingsCard userId={null} />);
    render(<DesignSystemSettingsCard userId={null} />);

    // Both cards should render error chips
    expect(document.querySelectorAll(".cf-ds-semantic-chip--error")).toHaveLength(2);

    // Flip to explicit dark mode via store
    act(() => {
      useUIStore.getState().setDesignTokenPreferences({ colorMode: "dark" });
    });

    await waitFor(() => {
      const chips = document.querySelectorAll(".cf-ds-semantic-chip--error");
      // Both instances must switch to glow surface
      chips.forEach((chip) => {
        expect(chip).toHaveClass("cf-ds-semantic-chip--glow");
        expect(chip).not.toHaveClass("cf-ds-semantic-chip--shadow");
      });
    });

    unmount1();
  });

  // ── Issue 5: Harmony wheel desync on rapid harmony switching ─────────────
  it("wheel markers stay consistent after rapid harmony switches", async () => {
    render(<DesignSystemSettingsCard userId={null} />);

    fireEvent.change(getRangeFromLabel(/Primary hue:/i), { target: { value: "30" } });

    const harmony = screen.getByRole("combobox", { name: /Color harmony/i });
    fireEvent.change(harmony, { target: { value: "triadic" } });
    fireEvent.change(harmony, { target: { value: "complementary" } });
    fireEvent.change(harmony, { target: { value: "triadic" } });

    await waitFor(() => {
      const prefs = useUIStore.getState().designTokenPreferences;
      // triadic: accent = primary + 120 = 150
      expect(prefs.accentHue).toBe(150);
      expect(screen.getByLabelText("accent wheel marker")).toHaveAttribute("data-hue", "150");
    });
  });
});
