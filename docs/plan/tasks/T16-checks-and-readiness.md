# T16 — Identity/fraud checks and application readiness

V2 amendment — October 8, 2026, **not implemented**: [V2-06](../v2/04-delivery-and-validation.md#v2-06--simulated-loan-footprint), after V2-01's address contract, adds informational Loan Footprint with a mock map and revision-bound country result. Its acceptance requires US clear, non-US not clear, missing input unknown, stale-address rejection and no new readiness gate. [V2-04](../v2/04-delivery-and-validation.md#v2-04--document-workspace-and-reviewed-financial-facts) adds provenance-aware financial changes and invalidation only for genuinely dependent rules. Existing human decisions and mandatory check policies remain.

Dependencies: T12, T14, T15. Read [domain](../03-domain-and-access.md) and [job behavior](../04-integrations-and-jobs.md).

## Outcome

Required identifiers and evidence drive background checks and an explainable readiness summary.

## Scope

- Add private identifier-entry tasks using T15's encrypted service and explicit authorization prerequisites.
- Implement delayed fake identity/fraud adapters, prerequisite evaluation, input-version tracking, and visible execution/outcome states.
- Reconcile missing-document requirements against current reviewed evidence; avoid duplicate work already represented by T12 tasks.
- Add bank checks/readiness panels and borrower-safe next actions. Show staff-only evidence and simulation labels appropriately.
- Define stage-aware submission, approval, and closing gate evaluation, including permitted waivers and staff resolutions of non-clear outcomes.

## Acceptance criteria

- Creating a draft with missing EIN/SSN leaves checks waiting and does not block minimal intake. Supplying the final prerequisite starts one current run.
- A later-stage check does not block an earlier gate merely because it exists. Each blocker identifies its stage and reason.
- Required current evidence/checks must pass or have an explicitly permitted, audited resolution; failed, stale, running, and unknown results never count as clear.
- Simulated risk flags do not automatically approve or decline an application.
- New/removed/replaced documents reconcile requirements without losing manual tasks or review history.
- Old check results cannot overwrite newer identifiers or a frozen decision snapshot; retry and resolution actions enforce bank authorization.

## Validation

Test missing prerequisites, all result categories, stage-specific gates, staff-resolution policy, stale input/results, worker restart, and duplicate triggers. Run two-owner fixtures to verify separate private tasks and checks. Demonstrate a clear application and one requiring staff review.

Defer credit scoring, automatic decisioning, and real KYC/KYB/tax checks. T19 consumes readiness to control submission and decisions.

## Implementation record

Implemented October 7, 2026. Backend, API/runtime and browser acceptance passed alongside T17/T18; see checkpoint validation below.

- Migration `0014_omniscient_frightful_four` adds bank/application-scoped check policies, immutable run generations, audited per-run staff resolutions, and private input-task links. Identity policy is separate for each disclosed owner relationship; the business has a fraud check. The initial `demo-checks-v1` policy assigns these checks to approval, so missing identifiers do not block minimal intake or earlier submission requirements.
- Private synthetic EIN/SSN entry and optional explicit sample-tax authorization use T15's encrypted identifier service in the same transaction as their safe task receipts and durable check intent. The complete task response includes masked input metadata up front. No generic answer, submit, waiver, or review action can bypass a secure input task. Historical T12 readiness confirmations retain their original meaning. Participant revocation does not silently restore secure task assignment on reinvitation.
- Configurable delayed identity/fraud providers return strict `clear`, `needs_review`, or `unable_to_verify` simulation evidence. Durable leased runs handle retry, timeout, restart, duplicate triggers, and stale results. Fingerprints reference immutable identifiers, subject/participation generations, application facts, and current reviewed document versions. They exclude lifecycle revision so submission itself does not invalidate otherwise unchanged evidence. Results arriving after an approved/closing/terminal snapshot are rejected; material identifier, authorization, and confirmed-fact edits are allowed only during collection.
- Only staff can retry or resolve a current check. Policy permits an explicit, audited resolution of a successful `needs_review` result; failed, timed-out, stale, unknown, or `unable_to_verify` results cannot be resolved as clear. The original finding and its history remain intact. No simulated result changes the application decision.
- Stage readiness combines completed setup, valid initial business/product/amount data, verified applicant authority, current task evidence or current audited waivers, required checks, and current signature evidence. Later-stage items do not block earlier stages. Staff see full application readiness and typed check evidence; borrower responses contain only their authorized tasks/own checks and label the result as their requirements. T19/T20 still enforce command authority, immutable decision/approved-term snapshots, and funding transitions.
- Existing document requirements are reused. New/replaced evidence makes prior check results stale without deleting manual tasks, review history, or original provider findings. Linked evidence must be current, clean, and reviewed unless its task has a permitted waiver.

### Backend validation

- Eleven focused contract/provider unit tests passed, including delayed identity/fraud results, every non-clear category, safe input/output boundaries, transient errors, terminal errors, and deadlines.
- Fifteen new real-PostgreSQL integration cases passed: missing prerequisites, two-owner privacy, encrypted capture, duplicate claims, staff resolution policy, in-flight identifier replacement, frozen input edits, reviewed document replacement, retries/lease expiry, owner revocation/re-addition, scoped identifier constraints, clear approval versus later closing requirements, explicit tax consent/reset, timeout recovery, fresh generations when facts return to an earlier value, and rejection of unaudited waiver rows.
- Four new T16 HTTP cases passed across Fastify and the native Worker handler. They verify eager secure metadata, identifier/consent writes, input and revision validation, Origin/CSRF guards, staff resolution and retry authorization, owner privacy, redacted findings, and scoped readiness. The shared workflow suite also passed four notification/signature transport cases, including authenticated raw-body HMAC callbacks without browser credentials and duplicate-event suppression.
- Domain, integrations, and API TypeScript checks passed; the owned files pass Biome. The focused combined regression run passed 35 tests across checks, the new workflow API suite, the existing task API suite, and participant/task links. Historical task fixtures now select their stable requirement key while also asserting the new private tasks, preserving prior privacy and assignment-lifecycle coverage. Browser acceptance remains pending.
- All providers are synthetic in every environment. Hosted acceptance is not inferred from local service or worker tests.


## Checkpoint validation

Done locally — October 7, 2026.

- `pnpm check`: Biome/browser boundaries, all workspace/root TypeScript checks, and 270 unit tests passed.
- `pnpm test:integration`: 290 tests across 31 real-PostgreSQL suites passed, including both Fastify and native Worker transports. Legacy tests now select the intended owner confirmation explicitly rather than assuming only one private task exists.
- Eight new desktop/mobile browser journeys passed in `.local/e2e-SOf9Sd/summary.json`; eighteen final regressions passed in `.local/e2e-PwIXkD/summary.json`. This covers secure-input saves/authorization reset, check review/retry/staleness, two intended signers using Mailpit continuation, immutable artifact download, source replacement, signature failure/expiry/void/decline, persisted preferences, instant task expansion, conflicts and dashboard navigation. Screenshots were inspected at both viewport sizes.
- Additive migrations 0014–0016 were applied to the local demo; `/api/ready` reports database and worker ready. `pnpm build` and native API/jobs bundle checks pass. Existing Vite chunk-size advisories remain non-fatal.
- Every provider and signature is visibly simulated. D03 tracks hosted sign-in/delivery parity; local and native-handler tests do not establish complete hosted workflow acceptance. T19/T20 remain responsible for submission/decision/funding commands; T21 assembles staff operations.
