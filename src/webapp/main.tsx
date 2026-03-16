import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { initDB } from "../core/services/db";
import { App } from "./App";
import "./styles/globals.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Webapp root element not found.");
}

// Warm the shared DB connection at startup so onboarding data can load immediately.
void initDB();

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline cache registration is best-effort.
    });
  });
}

createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
