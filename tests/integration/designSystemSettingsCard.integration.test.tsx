import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

import { DesignSystemSettingsCard } from "../../src/webapp/components/settings/DesignSystemSettingsCard";
import { useUIStore } from "../../src/webapp/store/uiStore";

function resetDesignState(): void {
  useUIStore.getState().resetDesignTokenPreferences();
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

    const sliders = screen.getAllByRole("slider");
    expect(sliders.length).toBeGreaterThanOrEqual(4);

    fireEvent.change(sliders[0], { target: { value: "2.35" } });
    fireEvent.change(sliders[1], { target: { value: "1.333" } });

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

    const sliders = screen.getAllByRole("slider");
    fireEvent.change(sliders[1], { target: { value: "1.5" } });

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

    const sliders = screen.getAllByRole("slider");
    fireEvent.change(sliders[1], { target: { value: "1.5" } });
    expect(useUIStore.getState().designTokenPreferences.typeRatio).toBe(1.5);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Keep Changes\?/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_500);
    });

    expect(useUIStore.getState().designTokenPreferences.typeRatio).toBe(before.typeRatio);
  });
});
