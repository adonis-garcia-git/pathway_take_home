import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: [
      "convex/lib/__tests__/**/*.test.ts",
      "convex/__tests__/**/*.test.ts",
    ],
    server: { deps: { inline: ["convex-test"] } },
  },
});
