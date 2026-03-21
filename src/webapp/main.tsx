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
    void navigator.serviceWorker.register("./sw.js").then((registration) => {
      // Keep registration fresh so updates are discovered quickly.
      void registration.update();

      const notifyWaitingWorker = () => {
        if (registration.waiting) {
          registration.waiting.postMessage("SKIP_WAITING");
        }
      };

      notifyWaitingWorker();

      registration.addEventListener("updatefound", () => {
        const installingWorker = registration.installing;
        if (!installingWorker) {
          return;
        }

        installingWorker.addEventListener("statechange", () => {
          if (installingWorker.state === "installed") {
            notifyWaitingWorker();
          }
        });
      });

      let hasRefreshedForNewWorker = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hasRefreshedForNewWorker) {
          return;
        }

        hasRefreshedForNewWorker = true;
        window.location.reload();
      });
    }).catch(() => {
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
