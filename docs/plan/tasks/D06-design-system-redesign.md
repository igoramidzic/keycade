# D06 — Design system and interface redesign

Requested October 8, 2026: “Look at the 4 interfaces, the synthetic bank site, the borrower dashboard, the application wizard, and the lender dashboard. I want you to use a design system here and rebuild it to be easy to understand, easy to read, things laid out correctly, spaced correctly… more elegant for a customer/client to be client focused and for lenders to be easy to understand applications.”

Dependencies: V2-07 (integrated borrower/lender experience) and T22. Read the [design-system decision](../06-decisions-and-sources.md#design-system-redesign--october-8-2026) and the [shared UI guide](../../../packages/ui/README.md#design-system).

## Outcome

One Keycade design system, built on the CLI-generated shadcn/ui primitives, styles all three web applications. The bank site reads as a credible fictional bank, the borrower experiences are client-focused and calm, and the lender console makes an application's state, facts, outstanding work and evidence easy to scan. Behavior, data, access rules and simulations are unchanged.

## Scope

- Theme tokens: cool-neutral canvas, deep sapphire brand, paired strong/soft status tones that meet WCAG AA, demo-tool tokens, soft elevation, and the existing 16px/14px readable type scale with Geist.
- Primitive sizing: 40px default controls (36px small), bordered cards with 24px padding, semantic Badge and Alert variants, and merged `buttonVariants` classes for link-buttons.
- Composed primitives in `packages/ui`: app shell with a header account slot, brand mark/lockup, page and section headings, status pill/text with shared application-status tones, description lists, empty and loading states. Separator, Progress, Skeleton, Avatar, Table and Label were added with the shadcn CLI.
- Bank site: rebuilt landing page with navigation, hero and decorative application preview, financing uses, how-it-works steps, call to action and footer.
- Borrower portal: header account controls (identity, demo inbox, reminder popover, sign out), welcome panels beside sign-in, application list cards, task dashboard (toned task rows, next-step actions, application details with purpose chips and a vertical stage timeline, upload drop zone, loan officer and history panels) and the setup wizard (step rail, single focused question card, Back above the question, illustrated purpose cards, review summary with Edit actions, Continue later footer).
- Lender console: header account controls, staff welcome panel, table-style application queue with aligned columns and a two-column mobile layout, application header card with underline tabs, overview with business/loan fact grids, redesigned financial metric cards and history chart, stage groups that distinguish action, review, record and check items, evidence group, and a side column for assignment, borrower setup and recent activity.
- Shared workflow panels (tasks, documents and the document viewer, checks/readiness, review and decisions, closing, participants, signatures, operations, activity, demo inbox, funded accounts, staff forms and the Scenario kit) adopt the same tokens and patterns.

Out of scope: copy rewrites that change meaning, new product capabilities, schema/API changes, dark-mode enablement and real branding of a financial institution.

## Acceptance criteria

- All visible copy, accessible names, roles, landmark/region names and keyboard behavior that the existing browser suite exercises remain intact; any deliberate copy change updates its tests in the same change.
- Status is never conveyed by color alone; text/background pairs meet WCAG AA; focus rings are visible on every interactive control.
- Borrower list and dashboard keep zero `progressbar` roles; the setup wizard keeps one native setup progress bar; uploads keep native progress.
- Desktop and 390px mobile layouts have no horizontal overflow; the Scenario kit stays fixed and separately colored on wide screens and opens as a dialog on narrow screens.
- Biome, all workspace typechecks/builds, unit tests and the local desktop/mobile browser suite pass, with results recorded below.

## Implementation record

In progress — October 8, 2026.
