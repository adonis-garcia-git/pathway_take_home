import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["convex/lib/__tests__/**/*.test.ts"],
  },
});
