import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const DESIGN_TOKENS_STORAGE_KEY = "courseforge.designTokens.v1";
const DESIGN_TOKENS_BACKUP_KEY = "courseforge.designTokens.corruptedBackup.v1";
const DESIGN_TOKENS_FIRST_RUN_KEY = "courseforge.designTokens.firstRunComplete.v1";
const DESIGN_TOKENS_PROFILE_KEY = "courseforge.designTokens.profile.v1";
const THEME_STORAGE_KEY = "courseforge.theme";

const EXPECTED_LOCKED_MAJOR_HEX = "#2563EB";

async function importFreshUiModules(): Promise<{
  Header: (props: { isSettingsView?: boolean }) => React.JSX.Element;
  DesignSystemSettingsCard: (props: { userId: string | null; placementClassName?: string }) => React.JSX.Element;
  useUIStore: {
    getState: () => {
      designTokenPreferences: {
        gamma: number;
        colorHarmonyBaseHue: number;
        colorHarmonySaturation: number;
      };
    };
  };
}> {
  const [{ Header }, { DesignSystemSettingsCard }, { useUIStore }] = await Promise.all([
    import("../../src/webapp/components/layout/Header"),
    import("../../src/webapp/components/settings/DesignSystemSettingsCard"),
    import("../../src/webapp/store/uiStore"),
  ]);

  return {
    Header,
    DesignSystemSettingsCard,
    useUIStore,
  };
}

describe("Design token bootstrap across workspace/settings/DSC", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    window.localStorage.removeItem(DESIGN_TOKENS_STORAGE_KEY);
    window.localStorage.removeItem(DESIGN_TOKENS_BACKUP_KEY);
    window.localStorage.removeItem(DESIGN_TOKENS_FIRST_RUN_KEY);
    window.localStorage.removeItem(DESIGN_TOKENS_PROFILE_KEY);
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.cssText = "";
  });

  it("loads the same default harmony color on startup, workspace/settings surfaces, and DSC controls", async () => {
    const { Header, DesignSystemSettingsCard, useUIStore } = await importFreshUiModules();

    const prefs = useUIStore.getState().designTokenPreferences;
    expect(prefs.colorHarmonyBaseHue).toBeGreaterThanOrEqual(0);
    const expectedDefaultHex = EXPECTED_LOCKED_MAJOR_HEX;

    const workspaceRender = render(
      <MemoryRouter>
        <Header isSettingsView={false} />
      </MemoryRouter>
    );

    expect(screen.getByText("CourseForge")).toBeInTheDocument();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--cf-ds-harmony-major")).toBe(EXPECTED_LOCKED_MAJOR_HEX);

    workspaceRender.unmount();

    render(
      <MemoryRouter>
        <Header isSettingsView />
        <DesignSystemSettingsCard userId={null} />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "Workspace" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    await waitFor(() => {
      expect(screen.getByLabelText("base harmony hex")).toHaveValue(expectedDefaultHex);
      expect(screen.getByLabelText("brand harmony hex")).toHaveValue(expectedDefaultHex);
      expect(document.documentElement.style.getPropertyValue("--cf-ds-harmony-major")).toBe(EXPECTED_LOCKED_MAJOR_HEX);
    });

    fireEvent.change(screen.getByLabelText(/Base Hue:/), { target: { value: "12" } });
    await waitFor(() => {
      expect(useUIStore.getState().designTokenPreferences.colorHarmonyBaseHue).toBe(12);
      expect(screen.getByLabelText("base harmony hex")).toHaveValue(expectedDefaultHex);
      expect(document.documentElement.style.getPropertyValue("--cf-ds-harmony-major")).toBe(EXPECTED_LOCKED_MAJOR_HEX);
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    await waitFor(() => {
      expect(screen.getByLabelText("base harmony hex")).toHaveValue(expectedDefaultHex);
      expect(screen.getByLabelText("brand harmony hex")).toHaveValue(expectedDefaultHex);
      expect(document.documentElement.style.getPropertyValue("--cf-ds-harmony-major")).toBe(EXPECTED_LOCKED_MAJOR_HEX);
    });
  });
});
