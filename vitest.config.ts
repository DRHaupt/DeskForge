import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20000,
    // next-auth imports "next/server" without an extension; let Vite resolve it.
    server: { deps: { inline: ["next-auth"] } },
    hookTimeout: 60000,
  },
});
