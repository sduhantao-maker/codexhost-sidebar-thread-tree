import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@codexhost/shared-contracts": fileURLToPath(
        new URL("./contracts/shared-contracts.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Node 25+ has its own localStorage, which would hide jsdom's.
    execArgv: ["--no-experimental-webstorage"],
  },
});
