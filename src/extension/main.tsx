import React from "react";
import { createRoot } from "react-dom/client";

import { clearAllCourseForgeCachesOnDevStartup } from "../core/services/cacheControlService";
import { SidebarApp } from "./SidebarApp";
import "./styles/sidebar.css";

function applySystemThemePreference(): void {
  if (typeof window === "undefined" || typeof document === "undefined" || !window.matchMedia) {
    return;
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = (): void => {
    document.documentElement.setAttribute("data-theme", mediaQuery.matches ? "dark" : "light");
  };

  apply();
  mediaQuery.addEventListener("change", apply);
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Extension root element not found.");
}

applySystemThemePreference();
void clearAllCourseForgeCachesOnDevStartup();

createRoot(rootElement).render(
  <React.StrictMode>
    <SidebarApp />
  </React.StrictMode>
);
