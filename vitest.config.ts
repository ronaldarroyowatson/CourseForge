import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/integration/setup.ts"],
    globals: true,
    exclude: ["**/node_modules/**", "**/xml.*.test.ts"],
    testTimeout: 30000,
  },
});
