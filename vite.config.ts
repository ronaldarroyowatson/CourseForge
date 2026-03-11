import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/webapp",
  plugins: [react()],
  build: {
    outDir: "../../dist/webapp",
    emptyOutDir: true,
  },
});
