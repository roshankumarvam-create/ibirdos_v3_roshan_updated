import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts", "src/**/*.test.ts"],
    setupFiles: [], // no global setup needed for this package
  },
  resolve: {
    alias: {
      "@ibirdos/config": path.resolve(__dirname, "../../packages/config/src"),
      "@ibirdos/logger": path.resolve(__dirname, "../../packages/logger/src"),
    },
  },
});
