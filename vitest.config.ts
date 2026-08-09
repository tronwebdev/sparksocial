import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // `apps/**` is included for the API only — its auth resolver is the tenancy
    // boundary, and a manual curl is not a regression guard. `apps/web` has no
    // test directory: a Next shell with no logic gains nothing from jsdom, and
    // `npm run build:web` in CI catches what actually breaks there.
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
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
      "@sparksocial/shared/genome": r("./packages/shared/src/genome.ts"),
      "@sparksocial/shared/untrustedRender": r("./packages/shared/src/untrustedRender.ts"),
      "@sparksocial/shared": r("./packages/shared/src/index.ts"),
      "@sparksocial/db": r("./packages/db/src/index.ts"),
      "@sparksocial/tools/defineTool": r("./packages/tools/src/defineTool.ts"),
      "@sparksocial/tools": r("./packages/tools/src/index.ts"),
      "@sparksocial/genome": r("./packages/genome/src/index.ts"),
      "@sparksocial/publish": r("./packages/publish/src/index.ts"),
      "@sparksocial/playbooks": r("./packages/playbooks/src/index.ts"),
      "@sparksocial/assemble": r("./packages/assemble/src/index.ts"),
      "@sparksocial/assetgraph": r("./packages/assetgraph/src/index.ts"),
      "@sparksocial/campaign": r("./packages/campaign/src/index.ts"),
      "@sparksocial/capture": r("./packages/capture/src/index.ts"),
      "@sparksocial/guardrails": r("./packages/guardrails/src/index.ts"),
      "@sparksocial/finish": r("./packages/finish/src/index.ts"),
      "@sparksocial/spark": r("./packages/spark/src/index.ts"),
      "@sparksocial/storage": r("./packages/storage/src/index.ts"),
    },
  },
});
