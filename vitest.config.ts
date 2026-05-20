import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    external: ["node:sqlite", "sqlite"]
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
