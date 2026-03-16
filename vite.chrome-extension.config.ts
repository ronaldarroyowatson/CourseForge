import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import fs from "fs";

export default defineConfig({
  root: "src/extension",
  build: {
    outDir: "../../dist/extension-chrome",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/extension/index.html"),
      },
    },
  },
  plugins: [
    react(),
    {
      name: "copy-chrome-extension-files",
      closeBundle() {
        fs.copyFileSync(
          resolve(__dirname, "src/extension/manifest.chrome.json"),
          resolve(__dirname, "dist/extension-chrome/manifest.json")
        );

        fs.copyFileSync(
          resolve(__dirname, "src/extension/background.js"),
          resolve(__dirname, "dist/extension-chrome/background.js")
        );
      },
    },
  ],
});
