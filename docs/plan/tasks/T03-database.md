# T03 — Drizzle, core records, migrations, and seed data

Dependencies: T02. Read [domain](../03-domain-and-access.md) and [architecture](../02-architecture.md).

## Outcome

Versioned core storage and useful synthetic records that every later feature can extend.

## Scope

- Add the server-only Drizzle package and PostgreSQL connection lifecycle.
- Create core bank, user/contact, bank membership, business, product, application, participant, and audit-record tables. Keep a draft's business/details nullable until supplied.
- Add keys, bank-scoped relationships, timestamps, revisions, lifecycle values, and exact monetary representation. Add future feature tables in their own tasks.
- Add migration generation/application, idempotent seeds, and the local Studio command. Connect initialize and dev schema readiness to committed migrations.
- Seed Bank A, isolated Bank B, borrower/staff identities, two businesses, multiple drafts, and $10k/$5m/$7.5m examples. Mark all fixtures synthetic.

## Acceptance criteria

- Committed migrations create an empty database reproducibly; repeated migrate/seed creates no duplicate fixtures.
- Exact amounts survive writes/reads as decimal strings; invalid amounts and cross-bank relationships are rejected.
- One borrower can hold explicit participation in two applications without all business applications being implicitly shared.
- Initialization now runs real migrations/seeds only against the recognized project-owned local target. An unfamiliar target is rejected before mutations. Dev identifies a behind/unusable schema and provides the migration command.
- `pnpm db:studio` opens the local schema without exposing it publicly. No secrets enter browser packages.

## Validation

Use disposable real PostgreSQL to test migrations, uniqueness/foreign keys, decimal precision, seed idempotency, and transaction rollback. Inspect representative seed records in Studio. Record the fixtures later tasks can reuse.

Defer tokens, tasks, document versions, provider runs, and loan-account tables to their owning tasks.

## Implementation record

Implemented October 6, 2026 in `packages/db`, with Drizzle ORM 0.45.3, Drizzle Kit 0.31.11, and node-postgres 8.23.1. Core schema is migration `0000`; T05 adds `0001` separately. Migration snapshots and journal are tracked. Server-only helpers own their connection lifecycle and have no import-time mutations. The root local commands enforce target ownership before calling migration/seed helpers.

Validation:

- `pnpm test:integration` passed the database, domain, and API suites against disposable real PostgreSQL databases (28 tests before the separate T05 suite was added). The database suite verifies clean and repeated migrations, idempotent seeds that preserve edits, exact decimal strings including the numeric upper boundary, nullable drafts, invalid values, composite tenant foreign keys, uniqueness, revisions, and rollback.
- Database typecheck and 18 money unit tests passed. `drizzle-kit generate --config packages/db/drizzle.config.ts` reports no schema changes after both committed migrations.
- Schema readiness compares committed migration hashes and executes real column queries. The integration suite temporarily removes a required column and verifies failure with the migration command, then restores it.
- Root acceptance confirmed repeated `pnpm initialize` preserves environment bytes and a temporary synthetic bank record, PostgreSQL stop causes a failed query and failed `pnpm dev`, and `pnpm db:start` preserves the record. No data reset was performed. Studio was opened in the browser on its loopback listener; five seeded applications visibly include 10000.00, 5000000.00 and 7500000.00 USD plus the nullable draft. Private env values were absent from all three production bundles.

Fixtures are exported as `seedIds`: Bank A and isolated Bank B; borrower, two bank officers, restricted adviser and revoked owner; two Bank A businesses plus one Bank B business; $10k/$5m/$7.5m applications, a separate same-business application without a borrower grant, an isolated Bank B application, and an incomplete draft. All fixtures carry `synthetic: true` and use `example.test` email addresses. The borrower has exactly two explicit active application grants. Money is stored as `numeric(20,2)` and returned as strings; `normalizeMoney` rejects imprecise/invalid input before PostgreSQL's numeric conversion. Future amount-writing services must use the decimal-string contract.

No identity tokens, documents, tasks, identifiers, or funded-loan tables were introduced.
