# D06 — Design system and interface redesign

Requested October 8, 2026: “Look at the 4 interfaces, the synthetic bank site, the borrower dashboard, the application wizard, and the lender dashboard. I want you to use a design system here and rebuild it to be easy to understand, easy to read, things laid out correctly, spaced correctly… more elegant for a customer/client to be client focused and for lenders to be easy to understand applications.”

Dependencies: V2-07 (integrated borrower/lender experience) and T22. Read the [design-system decision](../06-decisions-and-sources.md#design-system-redesign--october-8-2026) and the [shared UI guide](../../../packages/ui/README.md#design-system).

## Outcome

One Keycade design system, built on the CLI-generated shadcn/ui primitives, styles all three web applications. The bank site reads as a credible fictional bank, the borrower experiences are client-focused and calm, and the lender console makes an application's state, facts, outstanding work and evidence easy to scan. Behavior, data, access rules and simulations are unchanged.

## Scope

- Theme tokens: neutral gray canvas, KeyBank-inspired red brand and charcoal text, paired strong/soft status tones that meet WCAG AA, demo-tool tokens, soft elevation, and the existing 16px/14px readable type scale with Geist.
- Primitive sizing: 40px default controls (36px small), bordered cards with 24px padding, semantic Badge and Alert variants, and merged `buttonVariants` classes for link-buttons.
- Composed primitives in `packages/ui`: app shell with a header account slot, brand mark/lockup, page and section headings, status pill/text with shared application-status tones, description lists, empty and loading states. Separator, Progress, Skeleton, Avatar, Table and Label were added with the shadcn CLI.
- Bank site: rebuilt landing page with navigation, hero and decorative application preview, financing uses, how-it-works steps, call to action and footer.
- Borrower portal: header account controls (identity, demo inbox, reminder popover, sign out), welcome panels beside sign-in, application list cards, task dashboard (toned task rows, next-step actions, application details with purpose chips and a vertical stage timeline, upload drop zone, loan officer and history panels) and the setup wizard (step rail, single focused question card, Back above the question, illustrated purpose cards, review summary with Edit actions, Continue later footer).
- Lender console: header account controls, staff welcome panel, table-style application queue with aligned columns and a two-column mobile layout, application header card with underline tabs, overview with business/loan fact grids, redesigned financial metric cards and history chart, stage groups that distinguish action, review, record and check items, evidence group, and a side column for assignment, borrower setup and recent activity.
- Shared workflow panels (tasks, documents and the document viewer, checks/readiness, review and decisions, closing, participants, signatures, operations, activity, demo inbox, funded accounts, staff forms and the Scenario kit) adopt the same tokens and patterns.

Out of scope: copy rewrites that change meaning, new product capabilities, schema/API changes, dark-mode enablement and replacing the fictional bank identity with a real institution. The user subsequently requested KeyBank’s color scheme; this palette is included.

## Acceptance criteria

- All visible copy, accessible names, roles, landmark/region names and keyboard behavior that the existing browser suite exercises remain intact; any deliberate copy change updates its tests in the same change.
- Brand tokens and primary buttons retain KeyBank red; routine action-needed/in-progress statuses, focus/selection, sidebar and charts use blue across all four interfaces, with coordinated dark tokens. Actual errors stay red; fictional names and simulation labels remain.
- Status is never conveyed by color alone; text/background pairs meet WCAG AA; focus rings are visible on every interactive control.
- Borrower list and dashboard keep zero `progressbar` roles; the setup wizard keeps one native setup progress bar; uploads keep native progress.
- Desktop and 390px mobile layouts have no horizontal overflow; the Scenario kit stays fixed and separately colored on wide screens and opens as a dialog on narrow screens.
- Biome, all workspace typechecks/builds, unit tests and the local desktop/mobile browser suite pass, with results recorded below.

## Implementation record

In progress — October 8, 2026.

## KeyBank palette follow-up — October 8, 2026

The user requested “Use key bank color scheme.” Shared tokens now use #b30000 primary actions, #cc0000 brand accents, #900000 hover, pale red selections, charcoal text and neutral gray/white surfaces. Dark tokens use readable lighter reds on charcoal. Existing semantic status and demo-tool tones remain separate. Dependencies are unchanged.

Reference: computed styles on the [KeyBank homepage](https://www.key.com/personal/index.html), inspected October 8, 2026: “Get Details” has #b30000 fill and white text; the “Get Started with Personal Banking Products & Services” heading uses #cc0000. Hover, soft fills, neutrals and dark tones are Keycade adaptations.

Done locally — October 8, 2026. Validation:

- Biome check of `packages/ui/src/styles/globals.css` and `git diff --check` pass.
- All three web app production builds pass using the installed Vite binary (`../../node_modules/.bin/vite build` from each app); existing large-chunk warnings remain for borrower and bank console. The pnpm launcher stalled in this environment, so these equivalent build scripts ran directly.
- `node_modules/.bin/playwright test tests/e2e/foundation.spec.ts --workers=2`: 10/10 desktop/mobile cases pass, covering all three app shells, navigation, no horizontal overflow and API availability/recovery.
- Direct relative-luminance checks of 11 changed brand/neutral text pairings per theme pass WCAG AA: minimum 5.27:1 light and 6.37:1 dark. Status colors were not changed.
- Browser inspection confirms the bank-site primary action computes to #b30000 with white text, with red accents and neutral surfaces visible in the rendered page.

This CSS-only follow-up does not mark the broader D06 redesign complete. No hosted deployment was performed.

## Blue action and status follow-up — October 8, 2026

The user requested blue for “Needs your action” and other routine UI that could feel like an error. Brand identity remains red; primary buttons, links, action/status icons, current steps, selected inputs, progress bars, uploads, focus rings and primary charts now use blue. Shared status components exclude the brand tone; actual danger/destructive states remain unchanged. Dependencies are unchanged.

Done locally — October 8, 2026. Validation:

- Biome passes for all 19 changed source files; `git diff --check` passes.
- Typechecks pass for shared UI and all three web apps; all three production Vite builds pass (existing large-chunk warnings remain). Installed workspace binaries were invoked directly.
- `node_modules/.bin/tsx scripts/e2e.ts tests/e2e/foundation.spec.ts tests/e2e/tasks.spec.ts`: **22 desktop/mobile cases pass**, zero skipped/failed/flaky, using disposable PostgreSQL data and isolated API processes. The first direct run against the active demo failed because the borrower fixture was unfinished and the shared API reached request limits; the isolated rerun resolved both conditions.
- Seven blue-action/brand text pairings per theme pass relative-luminance AA checks. Blue on its soft fill is 6.07:1 light and 7.24:1 dark; primary button text is 6.63:1 light and 10.00:1 dark.
- Browser inspection shows blue primary actions, in-progress labels and current-step/action-needed icons alongside the red logo and brand accents.

No hosted deployment was performed. The broader D06 redesign remains in progress.

## Red primary buttons with blue status — October 8, 2026

Restore red primary buttons (Continue, Apply and Start Application) per the user’s clarification. Blue info tokens are now independent of primary tokens, including a foreground token for filled blue controls. Routine badges, progress, selection, links, focus and application states stay blue. Dependencies are unchanged.

Done locally — October 8, 2026. Validation:

- Biome checks pass for all 14 source files changed by this clarification; `git diff --check` passes.
- Shared UI and all three web app typechecks pass; all three Vite builds pass (existing large-chunk warnings remain).
- `node_modules/.bin/tsx scripts/e2e.ts tests/e2e/foundation.spec.ts tests/e2e/intake.spec.ts --grep 'serves its workspace|bank apply, saved edits'`: **8 desktop/mobile cases pass**, including saved wizard edits, browser loss and completion; no failures, skips or flaky tests.
- Primary text contrast is 7.20:1 light / 6.94:1 dark; blue status text on its soft fill remains 6.07:1 / 7.24:1. Button hover and filled-blue foreground pairings also pass AA.
- Browser computed styles confirm the public Apply button is #b30000 with white text while its In progress badge is #005ea8 on #edf6ff.

No hosted deployment was performed.

## Charcoal demo kit — October 8, 2026

The user asked to make the demo sidebar “easier to understand, easier to use, and easier to read. Maybe a better color.” The Scenario kit is now the **Demo kit**: a charcoal console in every theme with an amber “Demo only” marker, replacing hard-coded indigo that sat too close to blue status color. Shared `demo` tokens and a `dark demo-kit` scope in `globals.css` drive it, so shadcn primitives inside adopt the console palette and kit actions never use brand red. Content follows numbered steps: choose a scenario (with a collapsible walkthrough), copy details into forms (business name and client email up front; business details and people grouped per person), add sample PDFs (upload destination shown first; each card tagged with its expected simulated result), and import demo text files. The collapsed desktop rail now reads “Demo kit”, and the mobile bar matches the console. Copy buttons confirm with a check icon. Labels, accessible names, region names and behavior exercised by the browser suite are unchanged. Dependencies are unchanged.

Done locally — October 8, 2026. Validation:

- Biome passes for the four changed source files; shared UI, borrower and bank console typechecks pass; all three Vite builds pass (existing large-chunk warnings remain).
- `node_modules/.bin/tsx scripts/e2e.ts` with `demo-scenarios`, `demo-text-import`, `borrower-dashboard-safety`, `borrower-dashboard-v2`, `lender-overview-v2` and `v2-integrated`: **44 desktop/mobile cases pass**, zero skipped/failed/flaky, using disposable PostgreSQL. After two copy-only label edits made during that run, the fixed-panel/separate-color/mobile-dialog case reran and passed (2/2).
- Kit text contrast: foreground 13.9:1 and muted 7.2:1 on cards, amber badge 10.2:1.
- Browser inspection of the borrower portal and bank console at 1280–1440px and 375px: fixed panel, collapsed rail, mobile dialog, expanded disclosures, upload-destination states and the copy-failure message.

No hosted deployment was performed.

## Dialogs, menus and in-button spinners — October 8, 2026

The user asked for a spinner inside buttons instead of “Saving…” text, in the setup wizard and elsewhere. `Button` now accepts `loading`: it disables the button, keeps the label in place (preserving width and accessible name) and overlays the shadcn Spinner. All 30 buttons that swapped their label for progress text across the borrower portal and bank console use it, including sign-in, setup Continue/Finish, task, document, review, closing and participant actions. The wizard keeps a screen-reader-only “Saving…” announcement; upload percentages and service-status text are unchanged. Dialog, Dropdown Menu and Spinner were added with `npx shadcn@latest add` (declining the prompt to overwrite the customized button) and themed with Keycade tokens: ink-tinted overlay, card surface with `shadow-lg`, sticky dialog footer and muted/danger menu items. The shared `CurrencyInput` is documented with the other composed primitives in the [UI README](../../../packages/ui/README.md). Dependencies are unchanged.

Done locally — October 8, 2026. Validation (shared with the other October 8 UI follow-ups in this change):

- `pnpm lint` (Biome and browser/server boundaries), root `tsc --noEmit` including `tests/`, and the shared UI, bank-console, borrower and bank-site typechecks pass. `pnpm test`: **425 unit tests** pass. All three web Vite builds pass (existing large-chunk warnings remain).
- `pnpm test:e2e` with `participants`, `collaborator-upload`, `staff-workspace`, `borrower-workspace`, `intake`, `demo-inbox` and `lender-overview-v2` (`.local/e2e-utpAIY`): **74 desktop/mobile cases — 65 passed, 8 skipped, 1 failed, 0 flaky**. The skips are the eight `demo-inbox` cases, which run only when `DEMO_INBOX_ENABLED=true`. The failure was the mobile *queue loading and service failure* case: by then the combined run had created 55 applications, pushing the seeded Synthetic Cedar Workshop off the first queue page. Rerun alone, it passed on desktop and mobile (2/2, `.local/e2e-ouo2wc`).
- Browser inspection against the local stack at 1280px and 375px (no horizontal overflow). No browser test relied on the replaced progress text. Labels and accessible names stay stable while loading, which the existing journeys exercise. No hosted deployment was performed.

## Green task status markers — October 9, 2026

At the user's request, the client task list shows tasks waiting for lender review as a green check on a light-green circle, with green “Submitted / Waiting for lender review” text. Completed and waived tasks show a white check on a solid green circle in both portals. This matches the setup wizard and timeline completion markers. Staff keep the blue clock for submitted tasks they need to review. Labels and accessible names are unchanged.

Done locally — October 9, 2026. Validation: Biome and the shared UI typecheck pass. `tasks.spec.ts --grep 'staff requests a task, borrower submits'` passed on desktop and mobile (2/2, `.local/e2e-N0BPwe`). It now also captures the client view right after submission, and the submitted and completed desktop screenshots were inspected.
