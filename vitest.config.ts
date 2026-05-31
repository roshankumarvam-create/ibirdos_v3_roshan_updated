import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/__tests__/**/*.test.ts", "**/*.test.ts", "**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/*.config.*", "**/migrations/**"],
    },
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@ibirdos/types":       path.resolve(__dirname, "packages/types/src"),
      "@ibirdos/permissions": path.resolve(__dirname, "packages/permissions/src"),
      "@ibirdos/config":      path.resolve(__dirname, "packages/config/src"),
      "@ibirdos/logger":      path.resolve(__dirname, "packages/logger/src"),
      "@ibirdos/ui":          path.resolve(__dirname, "packages/ui/src"),
    },
  },
});
