import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["_lib/**/*.test.ts", "sync/**/*.test.ts"],
  },
});
