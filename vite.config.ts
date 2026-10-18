import { defineConfig } from "vitest/config";

// Relative base so the app works under https://<user>.github.io/Calculator/
export default defineConfig({
  base: "./",
  build: { outDir: "dist", sourcemap: true },
  test: { environment: "node" },
});
