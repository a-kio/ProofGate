import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

const packages = [
  "shared",
  "config",
  "project-detection",
  "executor",
  "verification",
  "evidence",
  "storage",
  "reporting",
  "integration-sdk",
  "integrations",
  "core",
  "mcp-server",
] as const;

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      packages.map((name) => [
        `@proofgate/${name}`,
        `${root}packages/${name}/src/index.ts`,
      ]),
    ),
  },
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/fixtures/**", "**/node_modules/**"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["packages/**/src/**/*.ts", "apps/cli/src/**/*.ts"],
      exclude: ["**/*.d.ts", "apps/cli/src/ui/assets/**"],
    },
  },
});
