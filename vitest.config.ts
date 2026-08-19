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
    /**
     * Two rules, mirroring every package's `exports` map (`"." → src/index.ts`,
     * `"./*" → src/*.ts`), rather than one entry per import path.
     *
     * The enumerated version drifted, and always in the same direction: an
     * import that typechecks and resolves under Node fails only when a test
     * happens to pull it in. `@sparksocial/shared/safeUrl` sat unlisted long
     * enough for `crawl()` to be written against it, and the first test to
     * touch it failed with "Cannot find module" — a missing config line
     * presenting as broken source.
     *
     * Ordered subpath-first: Vite tries these in order and a bare-specifier
     * pattern would otherwise swallow `@sparksocial/db/creditRepository`.
     */
    alias: [
      { find: /^@sparksocial\/([^/]+)\/(.+)$/, replacement: r("./packages/$1/src/$2.ts") },
      { find: /^@sparksocial\/([^/]+)$/, replacement: r("./packages/$1/src/index.ts") },
    ],
  },
});
