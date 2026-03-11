import React from "react";
import { createRoot } from "react-dom/client";

import { initDB } from "../core/services/db";
import { App } from "./App";
import "./styles/globals.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Webapp root element not found.");
}

// Warm the shared DB connection at startup so onboarding data can load immediately.
void initDB();

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
