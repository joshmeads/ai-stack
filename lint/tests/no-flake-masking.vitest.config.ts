import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    retry: 2, // @hit
    testTimeout: 30000, // @hit
    hookTimeout: 30000, // @hit
    environment: "node",
  },
  server: { retry: 1, timeout: 5 },
});
