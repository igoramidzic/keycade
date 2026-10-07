# T01 — Workspace and application shells

Dependencies: none. Read [architecture](../02-architecture.md) and [development](../05-development-and-testing.md).

## Outcome

A small, buildable monorepo with empty application shells and the requested shared tooling.

## Scope

- Pin a supported Node LTS release, pnpm, and compatible framework/tool versions. Create pnpm workspaces, one lockfile, and Turbo tasks.
- Create React/Vite shells for `bank-site`, `borrower`, and `bank-console`; create Node API/worker entry points with graceful termination. No business endpoints yet.
- Add strict TypeScript configuration, root Biome configuration, and shared `config`, `contracts`, and `ui` boundaries.
- Configure Tailwind and initialize/add shadcn components using `npx shadcn@latest` with the supported monorepo workflow. Preserve default styling; add only components used by the shells.
- Add root build, lint, format, typecheck, and initial check commands. Mark development tasks persistent and uncached.

Cloudflare boundary: Frontend build output remains static and browser-safe for the future Cloudflare host; no Worker provisioning in this milestone.

## Acceptance criteria

- Each frontend renders its own name and a shared shadcn component; API and worker start and stop cleanly.
- Package imports respect workspace boundaries; no duplicated React runtime or frontend import of server modules.
- Shared UI/styles resolve from both borrower and bank apps in development and production builds.
- `pnpm build`, `pnpm lint`, and `pnpm typecheck` pass. Only the pnpm lockfile exists.
- README explains current commands without claiming database or feature behavior that later tasks add.

## Validation

Run the workspace checks and open all three shell pages. Inspect generated component provenance/configuration. No artificial unit tests of placeholder text or generated component internals are needed.

Defer database containers, authentication, and lending behavior to subsequent tasks.

## Implementation record

Implemented October 6, 2026 as part of the T01–T05 local foundation milestone.

- Added React/Vite shells for the mock bank site, borrower portal, and bank console. Each renders its own name, uses shared Button/Badge/Card components, links to the other apps, and checks live API health/readiness with loading, unavailable, and retry states. Future lending features are explicitly identified as unavailable.
- Pinned Node 24.21.0 and pnpm 10.34.6. All three apps use React and React DOM 19.3.0; the shared UI package declares matching peer dependencies and the shared Vite configuration deduplicates both runtimes. Workspace packages export their source through explicit boundaries; browser configuration includes only three public application URLs.
- Ran `npx --yes shadcn@latest init --cwd apps/bank-site --defaults --template vite --force --no-reinstall`, which resolved shadcn 4.21.3. Configured the documented monorepo aliases, then ran `npx --yes shadcn@latest add button badge card --cwd apps/bank-site --yes`; the CLI generated those components in `packages/ui`. Default `base-nova` neutral styling and Geist remain unchanged. See [shared UI provenance](../../../packages/ui/README.md).
- Frontend validation passed: production builds for all three applications, TypeScript checks for all three applications and shared UI, and scoped Biome checks. Shared CSS and locally bundled fonts resolve in both development and production builds. The root milestone validation covers aggregate `pnpm build`, `pnpm lint`, and `pnpm typecheck` and the API/worker process lifecycle.
- Opened and visually inspected all three pages in the browser, verified cross-app navigation, and checked the staff shell at a 390px mobile viewport. `pnpm test:e2e` passed all 10 desktop/mobile browser checks against the initialized API and database/worker readiness: healthy connections, navigation, shared font styling, no horizontal overflow, failure display, retry recovery, and rejection of an HTML fallback as a healthy API response.
- `pnpm test` passed 52 unit tests after adding initialization regression coverage; the focused `scripts/local-lib.test.ts` suite passed 16 tests. The single package-manager lockfile is `pnpm-lock.yaml`.

The shells remain a local foundation preview; authentication and business application flows belong to later tasks. The frontend builds are static and browser-safe for future hosting; this milestone does not provision Cloudflare Workers.

## UI cleanup — October 7, 2026

Removed the shared “Three connected workspaces” cards and the development-preview notice beneath them from all three pages at the user's request. The bank homepage's former section link now opens the borrower portal. Header navigation remains available. Shared UI TypeScript and scoped Biome checks passed; all 10 existing desktop/mobile foundation browser tests passed.
