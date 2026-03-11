import React from "react";
import { createRoot } from "react-dom/client";

import { SidebarApp } from "./SidebarApp";
import "./styles/sidebar.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Extension root element not found.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <SidebarApp />
  </React.StrictMode>
);
