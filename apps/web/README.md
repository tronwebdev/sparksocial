# @sparksocial/web

Next.js 15 (App Router) frontend. Design source of truth is the prototype in
`ui build/` — the `.dc.html` files, **not** `figma-system/fig-tokens.css`, which is
generic Figma boilerplate referenced by zero screens.

## Two rules that are not style preferences

**1. This app imports `@sparksocial/shared` and nothing else from `packages/`.**

Every capability is reached over HTTP through `POST /v1/tools/:name`, which enters
the same `invokeTool` chain SPARK uses (CLAUDE.md invariant 1). Importing
`@sparksocial/db` here would let a React component build a raw query and bypass the
scoped layer entirely — `packages/db/test/isolation.test.ts` walks `.tsx` files and
will fail the build if that happens.

**2. There is exactly one route handler: `src/app/api/tools/[name]/route.ts`.**

It is a transport proxy — it attaches the Clerk token and forwards. It contains no
capability logic, and `[name]` passes straight through, so a new tool needs zero
changes here. A second route handler under `src/app/api/` means someone is building
a capability outside the registry, which is the thing invariant 1 exists to prevent.

## tsconfig

This app has its own `tsconfig.json` extending the root — the one app that does.
`next dev` rewrites whatever tsconfig it is pointed at (injecting `jsx`, `plugins`,
`lib`), and letting it mutate the root config that governs `packages/db` and the
backend is not acceptable. It declares no `paths` and no `baseUrl` so it inherits
the single alias map at the root; note that TypeScript's `extends` *replaces* the
`paths` map rather than merging it, so aliases must stay defined in one place.

## Local dev

```bash
npm run dev -w @sparksocial/web    # :3000
npm run dev -w @sparksocial/api    # :8080
```

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` go in `.env.local`
(gitignored). `SPARK_API_URL` defaults to `http://localhost:8080`.
