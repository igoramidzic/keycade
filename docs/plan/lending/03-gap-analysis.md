# Gaps between KeyLend and the proposed lending workflow

The inspected baseline is commit `d69b44a`. KeyLend already provides resumable setup, scoped participation, private evidence, human financial-fact review, stage readiness, immutable decisions, simulated signing, closing gates and idempotent recorded funding. Those are useful foundations. The next work should add the missing lending concepts around them.

This is a source inspection, not a new execution of the application test suite. Historical acceptance evidence remains in the original task records. The target behavior below is **not implemented**.

## Prioritized gaps

| Priority | Current behavior and evidence | Missing capability and practical effect | Owning work |
| --- | --- | --- | --- |
| First | [Application schema](../../../packages/db/src/schema.ts) has a single product/amount; [setup service](../../../packages/domain/src/application-setup.ts) validates amount against that product and maps the former product step to amount | Separate total financing need, product preference and zero-to-many proposed facilities. A $9M need must survive a $5M 7(a) facility cap | L01, L02 |
| First | [Setup wizard](../../../apps/borrower/src/setup-wizard.tsx) implements the fixed-product journey; [T07](../tasks/T07-application-service.md) and [T08](../tasks/T08-intake.md) preserve that baseline | A saved product-choice question and a lender structure editor supporting arbitrary supported splits and amount changes | L02 |
| First | [Review](../../../packages/domain/src/review.ts) locks material inputs and permits information requests only from review; approved/closing amendments are deferred | An explicit amendment/hold/reapproval path that preserves prior submissions, decisions, acceptance and signatures | L02, L06 |
| High | [Task rules](../../../packages/domain/src/task-rules.ts) have simple product/amount predicates and per-owner tasks; [readiness](../../../packages/domain/src/readiness.ts) already distinguishes stages | Requirements scoped to package, facility and person, with real product overlays, exposure-aware routing and dependency-based invalidation | L03 |
| High | [Financial facts](../../../packages/contracts/src/financial-facts.ts) retain reviewed values and provenance; [overview](../../../packages/domain/src/staff-overview.ts) presents them | Financial spreads, a debt schedule, combined repayment capacity, sensitivities and a versioned credit memo | L04 |
| High | [Bank roles](../../../packages/db/src/schema.ts) are officer/admin; [review commands](../../../packages/domain/src/review.ts) accept authorized staff without lending limits | Separate recommendation, approval authority, independence/quorum and exception approval; splitting debt must not reduce required authority | L05 |
| High | [Review contract](../../../packages/contracts/src/review.ts) approves an amount with generic reason codes; the service allows less than the requested amount | Explicit counteroffers, fuller terms, dated offers and borrower acceptance. Today a lower amount can reach approval without a separate acceptance record | L06 |
| High | [Checks](../../../packages/domain/src/checks.ts) provide private, version-bound identity/fraud results and audited resolutions | Separate entity authority, program eligibility, credit-elsewhere review, guarantees, collateral/lien evidence and allowed versus prohibited exceptions | L03, L08 |
| High | [Notifications](../../../packages/domain/src/notifications.ts) and [notification intents](../../../packages/domain/src/notification-intents.ts) deliver lifecycle messages and reminders | Receipt/completeness clocks, incomplete-file notices, specific decline reasons, counteroffer/nonacceptance and delivery evidence | L07 |
| High | [Default closing conditions](../../../packages/domain/src/closing.ts) are an acknowledgement and signature condition; current signature gates are strong | Product/facility conditions, accepted-term documents, collateral clearance, legal authority, sources/uses and cross-facility closing dependencies | L08 |
| High | [Funding contract](../../../packages/contracts/src/closing.ts) takes one amount/date/reference; [closing schema](../../../packages/db/src/closing-schema.ts) makes package, funding and account unique per application | Per-facility packages/accounts, independent release authority, synthetic recipient instructions, partial package funding and reconciliation | L09 |
| Supporting | [Queue](../../../apps/bank-console/src/queue.tsx), [staff service](../../../packages/domain/src/staff.ts) and [activity](../../../packages/domain/src/activity.ts) already expose assignment/history | Named underwriting/closing owners, aging, pending approval/offer states and “waiting on” explanations | L03–L09 projections |
| Supporting | [Demo scenarios](../tasks/D05-demo-scenarios.md) and [V2 acceptance](../v2/04-delivery-and-validation.md) demonstrate the existing single-product workflow | Connected small/medium/large and mixed-product demonstrations, migration regressions and hosted parity for the expanded workflow | L10 |

## Existing controls to preserve

- Setup completion remains per application, persisted on the server and confirmed by the applicant. Changing a product must not restart completed setup or grant portal access.
- Staff alone invite collaborators. Ownership, signing authority, guarantees and access grants remain separate concepts.
- Client-completed tasks count toward submission, while lender review remains required at the relevant later gates. New underwriting must not restore a borrower-side review step.
- Document versions and adopted financial facts retain provenance. Analysis consumes reviewed facts and never silently overwrites them or turns a simulated check into a decision.
- Rules, decisions, signatures and funding bind to current immutable inputs. Keep stale-result fencing, transaction/outbox atomicity, rollback and actor-bound idempotency.
- Preserve bank/application/resource authorization in lists, counts, drilldowns, exports and direct commands. Extend it to facility relationships and staff authorities.
- Reuse the local Fastify and hosted Worker domain services. New adapters remain synthetic with configurable delays and injected clocks; D07's neutral product wording remains current.

## Changes to historical assumptions

| Historical rule | Target replacement | Migration rule |
| --- | --- | --- |
| Always assign Synthetic Business Credit; no product choice | Applicant preference plus supported lender-selected facility products | Preserve the legacy product; do not relabel old loans as SBA |
| One application product and amount | Overall financing request with versioned facilities and allocations | Add a one-facility legacy mapping without rewriting snapshots |
| Approved/closing terms cannot be reopened | Explicit hold and new review/offer/closing versions | Old records remain immutable; old commands cannot bypass a hold |
| Approved amount cannot exceed the old submitted amount | An increase requires a revised request/submission and new approval | Never mutate the old submission to make a larger approval pass |
| Any active demo officer/admin can decide and fund | Explicit policy-based credit and release authorities | Version rollout; no automatic migration of every officer to unlimited authority |
| One funding/account per application | One initial funding/account per supported term facility | Per-facility uniqueness plus compatibility for old command receipts |

These changes are authorized product direction from the user's October 12 follow-up. Exact bank thresholds, committee composition and product overlays are proposed demo defaults. The completed T-task evidence must not be relabelled as proof of L-task behavior.

## Work to defer

Keep full SBA submission/compliance automation, live credit/identity checks, real lien/title services, payment rails, syndicated lender settlement, 504 CDC settlement, repeated construction draws and revolving-credit utilization outside the initial implementation. Keep repayments, balances, accrual, collection and funded-debt modifications outside this plan. An existing loan's declared debt-service amount can be an underwriting input without building its servicing ledger.

For future real-world adaptation, a bank-specific review would also need to settle fair-lending controls, current small-business reporting applicability, retention/legal holds, security administration and all applicable notice rules. Those are not implemented or certified by this synthetic origination expansion.
