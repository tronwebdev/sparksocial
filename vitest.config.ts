import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/tools/src/policy.ts", "packages/db/src/scoped.ts"],
      // CLAUDE.md invariant 3: the policy engine is tested to 100% branch coverage.
      thresholds: {
        "packages/tools/src/policy.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@sparksocial/shared/types": r("./packages/shared/src/types.ts"),
      "@sparksocial/shared": r("./packages/shared/src/index.ts"),
      "@sparksocial/db": r("./packages/db/src/index.ts"),
      "@sparksocial/tools/defineTool": r("./packages/tools/src/defineTool.ts"),
      "@sparksocial/tools": r("./packages/tools/src/index.ts"),
      "@sparksocial/genome": r("./packages/genome/src/index.ts"),
      "@sparksocial/playbooks": r("./packages/playbooks/src/index.ts"),
      "@sparksocial/assetgraph": r("./packages/assetgraph/src/index.ts"),
      "@sparksocial/capture": r("./packages/capture/src/index.ts"),
      "@sparksocial/guardrails": r("./packages/guardrails/src/index.ts"),
      "@sparksocial/finish": r("./packages/finish/src/index.ts"),
    },
  },
});
