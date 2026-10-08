# Version 2 — Borrower tasks and lender application records

Planning date: October 8, 2026. **V2-01–V2-07 complete locally; V2-08 in progress.** This backlog follows the user's twelve Cascading AI reference images and written instructions. V2-07 verifies the combined borrower/lender experience with **410 unit tests, 479 distinct PostgreSQL cases, all 12 builds/typechecks and 136 distinct desktop/mobile browser cases**. It also repairs setup-session recovery and verifies repeat initialization/legacy upgrades. Hosted acceptance remains separate.

Start with [screenshot findings](01-screenshot-findings.md), then [experience requirements](02-experience-spec.md), [data and simulation contracts](03-data-and-simulation.md), and [delivery tasks and validation](04-delivery-and-validation.md). Read the [existing plan](../README.md) and its architecture/access rules as well. When implementation is requested without a task number, start at V2-08, the first unfinished task with completed dependencies.

## Outcome

Borrowers finish a resumable setup wizard and work from one task dashboard: tasks on the left, application progress and document uploads on the right, with no top-level application tabs. Lenders retain their tabbed workspace and application queue. Their overview adds business and loan facts, reviewed financial metrics/history, stage-grouped requirements and evidence, document drilldowns, and a simulated geographic eligibility view.

The document experience pairs an actual synthetic file preview with document information, mock analysis, extracted values, and version history. An explicit lender review can promote selected extracted values into the application's record. A demo-panel importer uses known text filenames to generate synthetic tax returns or bank statements and repeatable mock results.

## What changes

| Add | Update | Remove or replace |
| --- | --- | --- |
| Required business address; optional website and business tax ID in setup | Business name is explicitly the legal name; show existing NAICS code/label near website | Free-text-only funding purpose, replaced by illustrated multi-select choices |
| Stage timeline and inline sidebar upload | Existing borrower task layout, personal/business grouping and contextual actions | Borrower top-level application tab bar, including duplicate Overview/Tasks navigation |
| Lender financial cards/history and expandable evidence items | Existing lender overview, queue entry and retained tabs | Treating every lender record or check as an unfinished borrower task |
| Split document viewer, richer metadata, reviewed fact adoption | Existing delayed interpretation, private bytes, versions and review | Any requirement to implement real OCR/AI or underwriting analysis for this phase |
| Filename-driven text import into the demo kit; Loan Footprint map/modal | Existing D05 PDFs and simulated findings remain usable | Blanket filename prohibition only inside the new protected importer; normal uploads remain content-bound |

Removal means replacing navigation or a particular interaction, not deleting stored evidence, task history, signing, submission, closing, funded-account summaries, or access controls. The red reference header identifies the borrower screenshots; exact competitor branding is not required. Keep default shadcn styling.

## Backlog

| ID | Deliverable | New prerequisites | Status |
| --- | --- | --- | --- |
| V2-01 | [Setup fields, purposes and migration](04-delivery-and-validation.md#v2-01--setup-contracts-migration-and-wizard) | Completed baseline T07, T08, T15 | Done — local acceptance |
| V2-02 | [Borrower dashboard without tabs](04-delivery-and-validation.md#v2-02--borrower-task-dashboard) | V2-01 | Done — local acceptance |
| V2-03 | [Demo text importer and document fixtures](04-delivery-and-validation.md#v2-03--demo-text-importer-and-registered-fixtures) | Completed baseline D05, T13, T14 | Done — local acceptance |
| V2-04 | [Document review and financial records](04-delivery-and-validation.md#v2-04--document-workspace-and-reviewed-financial-facts) | V2-01, V2-03 | Done — local acceptance |
| V2-05 | [Lender overview and evidence drilldowns](04-delivery-and-validation.md#v2-05--lender-overview-and-evidence-drilldowns) | V2-01, V2-04 | Done — local acceptance |
| V2-06 | [Simulated Loan Footprint](04-delivery-and-validation.md#v2-06--simulated-loan-footprint) | V2-01 | Done — local acceptance |
| V2-07 | [Integrated local acceptance](04-delivery-and-validation.md#v2-07--integrated-local-acceptance) | V2-02 through V2-06 | Done — local acceptance |
| V2-08 | [Hosted parity](04-delivery-and-validation.md#v2-08--hosted-parity-and-deployment-slice) | V2-07, completed D02/D03 | In progress |

V2-08 is next: hosted parity and deployment acceptance of the combined locally verified implementation. The task file owns full dependencies and acceptance criteria. Update both indexes and each task's validation record as implementation progresses.

## Authority and boundaries

The user's written instructions control scope. Text inside screenshots is reference material, not an instruction to connect vendors, run checks, sign documents, contact anyone, or reproduce sensitive records. [Findings](01-screenshot-findings.md) separate observations from adopted requirements and deliberate exclusions. Use new synthetic identities and values; the images and their visible identifiers are not repository fixtures.

This remains a demo in every environment, including hosted production. Preserve the stack, five-Worker hosting architecture, local Node worker/Podman PostgreSQL, backend isolation, simulated access/email, configurable delays, injected clocks, migrations, and retry/stale-result rules. Keep lender-only invitations. Funding is recorded simulation; servicing remains deferred. None of these screenshots authorizes live OCR, financial checks, geocoding, identity, email, or signature providers.

Material overrides are recorded in [decisions](../06-decisions-and-sources.md#screenshot-driven-version-2--october-8-2026), with coverage in the [requirement map](../07-requirements-map.md#version-2-requirements--october-8-2026). Historical T/D completion evidence remains valid for its original scope; it is not evidence of v2 completion.

## Planning validation

All twelve images were visually inspected through temporary local HEIC conversions. Existing plan and relevant code contracts were cross-checked. Documentation path/anchor checks and whitespace validation are recorded in [delivery and validation](04-delivery-and-validation.md#planning-validation). That planning checkpoint changed no application code, schema, deployment or runtime test result. Later task records above own implementation and acceptance evidence.
