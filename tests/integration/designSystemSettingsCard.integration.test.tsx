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
