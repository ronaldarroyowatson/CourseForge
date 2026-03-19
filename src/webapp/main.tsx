import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";

import { initDB } from "../core/services/db";
import { App } from "./App";
import "./styles/globals.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Webapp root element not found.");
}

// Warm the shared DB connection at startup so onboarding data can load immediately.
void initDB();

const useHashRouter = typeof window !== "undefined" && window.location.protocol === "file:";
const Router = useHashRouter ? HashRouter : BrowserRouter;

if (typeof window !== "undefined" && window.location.protocol !== "file:" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline cache registration is best-effort.
    });
  });
}

createRoot(rootElement).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);
