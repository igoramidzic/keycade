# R01 Business lending research and expansion plan

Status: **Done — documentation validated October 13, 2026.** Requested October 12, 2026; continued October 13, 2026.

Dependencies: read the implemented T07–T20 and V2 product/data contracts. This task authorizes research and documentation, not implementation or deployment of L01–L10.

## Outcome

Explain how small, medium and large U.S. business loans move through a bank, identify gaps in Keycade, and give the next implementation tasks. Incorporate the user's product-choice and restructuring follow-up, including a $9M need split into $5M SBA 7(a) plus $4M of another product.

## Deliverables

- [Research overview](../lending/README.md) and [bank workflows](../lending/01-bank-workflows.md), with dated primary sources and distinctions between common practices, program rules and demo policies.
- [Nineteen product types and variants](../lending/02-products-and-restructuring.md), three initial families, versioned restructuring, exact allocations and per-facility funding design.
- [Code gap analysis](../lending/03-gap-analysis.md) against `d69b44a`, preserving existing controls and identifying the single-product/account assumptions.
- [L01–L10 delivery plan](../lending/04-delivery-and-validation.md) with dependencies, acceptance criteria, migrations, access/concurrency cases and separate hosted validation.
- Updated plan index, product/domain guidance, affected task handoffs, requirement map, decisions and root agent instructions.

## Acceptance criteria

- Explain the application, underwriting, decision, offer, closing and funding handoffs; distinguish amount from product complexity and borrower business size.
- Cover 10–20 additional product choices/variants and focus implementation on a few, including SBA 7(a).
- Define product selection, later amount/product changes, splitting/combining facilities, post-approval invalidation and immutable historical/funded records.
- Address the $9M example without claiming the proposed structure automatically qualifies or that a single $9M 7(a) is permitted.
- Ground key findings in official bank/regulator/program sources and inspected repository files; identify dated changes and source limits.
- Make implementation work concrete and dependency-ordered while leaving it Not started; retain all-environment simulation and deferred servicing.
- Verify local documentation links, task dependencies, status consistency and whitespace. Do not claim application test or deployment results for this documentation change.

## Validation record

External sources were read on October 12, 2026; the research used the June 2026 OCC lending handbook, current SBA product pages and July 2026 coordination notice, CFPB notification rules, FinCEN/FFIEC material and public bank product guides. The optional published KeyBank documentation connector returned HTTP 404 and is not used as evidence of private bank policy.

Completed October 13, 2026:

- Inspected baseline contracts, domain services and database constraints at `d69b44a`; the gap analysis links to the relevant implementation files rather than claiming that historical plans prove missing functionality.
- An inline Python documentation check passed for all 25 changed/new Markdown files: 365 local links resolved, heading fragments existed, 45 reference-style citations had definitions, and new files had clean whitespace/final newlines.
- A separate consistency check passed: the plan index and delivery table have the same ten L-tasks/dependencies/statuses, the dependency graph is acyclic, and each task has an outcome and validation criteria. All remain Not started.
- Confirmed 19 numbered product entries, three proposed initial families and 12 connected acceptance scenarios, including the $9M split, changed total, post-approval amendments and partial funding.
- `git diff --check` passed. Changes are documentation/agent instructions only; application tests, migrations and deployments were not run. This record completes research acceptance, not L01–L10 implementation acceptance.
