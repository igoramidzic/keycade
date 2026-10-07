# T04 — API boundaries, permission policy, and audit foundation

Dependencies: T03. Read [domain and access](../03-domain-and-access.md).

## Outcome

An API foundation that consistently validates requests, restricts reads/writes, and records consequential actions.

## Scope

- Configure Fastify modules, runtime request/response schemas, generated OpenAPI, structured errors/request IDs, safe logs, and health/readiness routes.
- Define actor contexts and central bank/application/task/document policy interfaces. Initial tests supply actors internally; do not add a public impersonation header or bypass endpoint.
- Implement common database transaction helpers, revision conflict handling, pagination/filter conventions, and append-only audit writes.
- Define public versus staff DTOs. Add allowed-origin, cookie, CSRF, return-URL, and rate-limit hooks to be used by T06.
- Test against seeded bank/participant data with a protected sample resource or initial application read service.

Cloudflare boundary: Keep server construction/domain services separate from the Node listen entry point for a future Cloudflare HTTP adapter; hosted compatibility is a separate validation gate.

## Acceptance criteria

- Invalid inputs have stable error shapes; serialization cannot leak sensitive/internal fields.
- Cross-bank and unauthorized same-bank direct-ID requests reveal no record content or existence beyond the chosen uniform denial contract.
- Service-level access checks hold even when invoked without HTTP routes.
- Successful consequential writes and their audit event commit together; failed transactions leave neither a partial change nor misleading success audit.
- Health distinguishes process liveness from database readiness. Production errors omit stack traces/secrets.

## Validation

Run HTTP and PostgreSQL integration tests for malformed data, tenant boundaries, permissions, transaction rollback, safe output, and stale revisions. Verify browser packages cannot import database configuration.

Authentication becomes real in T06; resource-specific scope rules expand with each feature. Do not postpone authorization until the UI is finished.

## Implementation record

Done — October 6, 2026. Fastify 5, Zod runtime request/response schemas, generated OpenAPI, uniform safe errors, server-generated correlation IDs and metadata-only logs are implemented in `apps/api`. Liveness is independent of session resolution; readiness checks current schema and a fresh worker heartbeat. Cookie, origin, CSRF, return-URL and rate-limit helpers prepare T06 without adding a public authentication bypass.

`packages/domain` enforces live bank/application grants even when invoked without HTTP. Restricted task/document policies deny by default until those resources exist. Public/staff schemas explicitly select response fields. The initial purpose-update service locks grants/current revision, validates editable lifecycle, and commits the update plus safe append-only audit together.

Validation: 12 HTTP/security unit tests and 12 domain/HTTP PostgreSQL integration tests pass. Cases cover invalid input/output leakage, cross-bank and same-bank direct-ID denial, revoked grants, anonymous/header impersonation denial, CSRF/origins/rate limiting, permission checks without HTTP, locked states, stale and concurrent revisions, audit rollback, and readiness vs liveness. Full builds/types/Biome and the browser/server boundary check pass. No credentials are present in browser bundles. Public application access remains unavailable until T06 connects real sessions.

See [the milestone validation record](../local-foundation-validation.md).
