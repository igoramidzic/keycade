# Lending expansion delivery and validation

All implementation tasks below are **Not started**. Read [the workflow research](01-bank-workflows.md), [product and restructuring contract](02-products-and-restructuring.md) and [code gap map](03-gap-analysis.md) first. The user's product-selection and restructuring request takes priority over the historical fixed-product plan.

## Build sequence

| Task | Outcome | Dependencies | Status |
| --- | --- | --- | --- |
| L01 | Product catalog and financing structure foundation | T03, T07, T12, T19, T20, V2-01 | Not started |
| L02 | Product choice and lender restructuring | L01, T08, T10, T11, T17 | Not started |
| L03 | Workflow routing and product diligence | L02, T12, T15, T16 | Not started |
| L04 | Underwriting workspace and credit memo | L03, V2-04, V2-05 | Not started |
| L05 | Credit authority and package decisions | L04, T19 | Not started |
| L06 | Offers and approval amendments | L05, T17, T19 | Not started |
| L07 | Application clocks and decision notices | L06, T18, D03 | Not started |
| L08 | Facility closing and collateral clearance | L03, L06, T17, T20 | Not started |
| L09 | Controlled funding for multiple facilities | L05, L07, L08, T20 | Not started |
| L10 | Connected scenarios and hosted acceptance | L01–L09, D03, V2-08 | Not started |

L01–L02 are the next useful demonstration: choose a loan type, save/resume, then restructure $9M into two or three facilities. Keep final decisions and funding for the new structured mode disabled until their owning tasks pass. Existing legacy demo journeys remain available and must not become a bypass for structured applications.

## Shared implementation instructions

Use the existing contracts → database/domain → both HTTP adapters → shared UI flow. Add schema incrementally with committed Drizzle migrations. Reuse tasks, private evidence, financial-fact review, signatures, outbox and audit services; do not build parallel copies of them. Match the KeyLend design system and D07 neutral wording.

Every mutating command needs current bank/application/facility authorization, expected revision and actor-bound idempotency. Material mutations and their invalidation/notification intent commit together. Serialize restructuring and funding on the same application boundary. Never allow a legacy endpoint to skip new guards. Index scoped reads and retain bounded queue/overview queries under the existing D04 performance direction.

Keep `synthetic`/`simulated` provenance, fake providers, delayed outcomes and injected clocks. Underwriter recommendations and simulated eligibility findings cannot decide credit. Product policies distinguish hard program constraints, bank-policy exceptions and documentation waivers; unknown inputs do not pass.

Each task must add relevant unit, real-PostgreSQL and both-transport checks with the behavior. Browser checks cover the actual changed workflow, including keyboard/mobile, save conflicts and denied access. Use the repository's installed commands and read its current tooling instructions; do not infer hosted success from local tests. Record commands/results and remaining limitations in the task's validation record below when implementation occurs.

## L01 Product catalog and financing structure foundation

**Outcome:** the database and contracts can represent an overall request, multiple facilities and immutable published structures without damaging legacy applications.

Add versioned supported-product fixtures for the three initial families, a reference-only catalog for the remaining researched types, request/preference records, structure drafts/revisions, stable facility identities/versions, sources/uses and explicit lifecycle capability flags. Resolve catalog family versus SBA variant server-side under a pinned policy. Separate total need from individual product limits.

Inspect `schema.ts`, `review-schema.ts` and `closing-schema.ts` before designing the migration. Add legacy mappings first; defer removing application-wide closing/funding constraints to L08/L09. Create an explicit mode/version boundary so structured applications cannot use legacy amount-only approval or funding.

Acceptance criteria:

- Save a $9M total need with an SBA preference and a proposed $5M/$4M split; amounts round-trip exactly. A $6M single 7(a) allocation is blocked from approval, while its incomplete proposal remains saveable.
- Validate distinct package totals, project cost, contributions and allocated uses. Zero/negative amounts, duplicate cost allocation and references to another bank/application fail.
- Support three or more facilities and split/combine lineage without hard-coded pairings. Replacing a product preserves earlier revisions and does not remove evidence.
- Upgrade unfinished, submitted, approved, closing and funded legacy fixtures without rewriting original snapshots, account IDs or receipts. Repeat migration/initialization is a no-op.
- Structured approval/funding is unavailable until implemented; direct calls to old routes cannot bypass this boundary.

Validation record: **Not started.** Use migration/upgrade, exact-decimal, foreign-key, rollback, race and replay tests with real PostgreSQL.

## L02 Product choice and lender restructuring

**Outcome:** borrowers choose a preference and staff can revise the financing request throughout origination.

Add the one-question product step with “Help me choose,” versioned resume mapping and a lender Financing workspace. Implement add/remove/split/combine/product/amount commands, draft saves, a before/after preview, publication reason and borrower-safe published views. Applicants can change their need during collection; later changes use the amendment workflow. Staff amendments create a hold even before L06 can approve the replacement.

Acceptance criteria:

- New and officer-prefilled applications save and resume the chosen product. Completed legacy setup stays complete; unfinished drafts keep acknowledged answers and a valid step.
- Demonstrate $9M → $5M SBA + $4M conventional → three facilities → an $8M revised need, preserving all previous versions and the original request.
- A draft with a gap is saveable and visibly incomplete. A published partial offer requires explicit reduced scope; no fake contribution fills the gap.
- Product changes reconcile only affected requirements. Shared evidence is referenced once where suitable; unrelated private tasks and manual tasks survive.
- Opening a change preview has no effect. Explicitly beginning an amendment atomically blocks old decisions/funding; abandoning it requires current-state validation.
- Submitted/approved/closing revisions preserve their records. Changes affecting signed documents schedule void/invalidation without deleting artifacts. Until L06/L08 exist, the UI explains why the replacement cannot proceed.
- Conflicting edits, revoked staff, restricted collaborators and cross-bank calls cannot publish or inspect private drafts. Keyboard/mobile, failed-save recovery and browser resume pass.

Validation record: **Not started.** Include a funding-versus-amendment transaction race and old-route bypass attempts, not just editor tests.

## L03 Workflow routing and product diligence

**Outcome:** the right people and evidence are assigned for the actual package, rather than every loan receiving one generic checklist.

Add a pinned workflow profile driven by products, aggregate commitment/exposure, purpose, entity complexity and policy exceptions. The small/medium/large bands are configurable fixtures. Capture received/completeness events now for L07; completeness is independent of setup completion and the UI Submit action. Add underwriting/closing assignments, “waiting on” and stage aging.

Represent business/owner/control/signer/guarantor relationships separately. Add the three product overlays, sources/uses, existing SBA exposure/affiliates, synthetic program authorization prerequisites and applicable collateral/guarantee requirements. Model applicability as unknown, applicable or not applicable with reasons and evidence. Extend stable requirement identities to include package/facility/person scope and revision.

Acceptance criteria:

- $10K, $750K, $5M, $7.5M and a $9M multi-facility request route as configured; a complex small request escalates and splitting cannot lower aggregate authority.
- Separate staff assignments and diligence conclusions from portal permissions. A guarantor or business owner does not automatically get application access or legal signing authority.
- SBA and conventional facilities receive distinct requirements and share current common evidence only through scoped links; missing eligibility/exposure information remains blocking at its assigned stage.
- Program hard stops cannot be waived through a generic task; a bank-policy exception records authorized reviewer, reason, compensating factors and expiry. Original findings remain intact.
- Changing an owner, use, amount, policy version or collateral input invalidates dependent results. Stale asynchronous results, repeated reconciliation and owner removal/re-addition do not revive old evidence or waivers.
- Queue/detail views expose current owner, elapsed stage time and missing items without leaking restricted counts or introducing unbounded per-row queries.

Validation record: **Not started.** Cover scope, policy-version pinning, current-input fences and clock behavior in unit/PostgreSQL/HTTP tests.

## L04 Underwriting workspace and credit memo

**Outcome:** staff can explain repayment capacity and recommend an actual financing structure.

Build on V2 reviewed financial facts. Add comparable financial periods, debt obligations, documented adjustments, guarantor analysis where required, projected debt service for all facilities, sensitivity cases and a versioned credit memo. Capture pricing, maturity, amortization assumption, fees and collateral/guarantee terms as origination inputs; no servicing schedule or accrual engine is required.

Acceptance criteria:

- Every input/derived result identifies period, unit, accounting basis, source, review state and formula/policy version. Missing values are unknown, not zero; incompatible periods cannot be summed silently.
- DSCR and other supported calculations show their numerator/denominator and deterministic rounding. Zero/missing debt service is not a passing ratio. Adjustable-rate and balloon assumptions are explicit fixture inputs.
- Combined analysis includes the full $9M obligation and relevant existing debt; it avoids double-counting refinanced debt, shared guarantor income and the same collateral support.
- An analyst can document risks, strengths, recommendation and exceptions without exercising credit authority. No calculated ratio, extraction or simulated credit result auto-approves a loan.
- Freezing the memo binds the structure, facility terms and evidence fingerprints. Revised facts or structure create a new analysis version; previous submissions/decisions remain unchanged.

Validation record: **Not started.** Test meaningful arithmetic, stale provenance, package isolation and restricted personal-financial evidence; demonstrate one small and one mixed-product memo.

## L05 Credit authority and package decisions

**Outcome:** only qualified staff can approve the current package under the bank's configured delegation.

Add bank-scoped capabilities for underwriting, credit approval, exception approval, closing preparation and funding release. Policy maps aggregate exposure, product and exceptions to individual/joint/committee requirements. Preserve existing bank roles for membership; do not treat them as unlimited credit authority. Approvers review the frozen memo and complete facility terms.

Acceptance criteria:

- An officer can recommend but cannot approve above their delegation; an admin is not an automatic override. Committee/quorum fixtures require distinct eligible voters and enforce configured independence.
- Two $4.5M facilities do not bypass a $9M approval level. Check package totals and applicable same-bank related exposure, with unknown external exposure explicitly reviewed.
- Votes bind to the exact package, policy and terms; stale votes, revoked authority, changed terms and conflicting final decisions fail transactionally.
- Final approval names each facility, conditions, reasons and effective/expiry dates. Unresolved underwriting conditions remain distinguishable from approved closing conditions.
- Exceptions have separate permitted authority. No task waiver overrides product hard stops, missing votes or a required signature.

Validation record: **Not started.** Prove direct-API authority denial, revocation, concurrent votes/decision, rollback and private-comment isolation.

## L06 Offers and approval amendments

**Outcome:** borrowers accept specific financing terms, and changes after approval follow a deliberate replacement process.

Add published offer versions, conditional terms, expiry, acceptance/nonacceptance and offer comparisons. Extend L02's amendment hold into new underwriting/decision/offer versions. Store amount, product, maturity, rate specification, fees, collateral, guarantees and required conditions for every facility. Prices remain fictional configured values.

Acceptance criteria:

- A reduced or changed product mix becomes an explicit offer/counteroffer. The borrower accepts the complete current version; approval alone does not record acceptance or authorize closing.
- Increasing the requested amount uses a new confirmed request/submission rather than editing the old snapshot or bypassing its amount guard.
- Changing one material facility term invalidates package approval/acceptance under the initial conservative policy; the unchanged evidence remains available for deliberate reuse.
- Expired, withdrawn or superseded offers cannot be accepted. An accepted offer still requires current credit/closing gates. Clock expiry does not silently classify borrower withdrawal or fabricate a denial reason.
- Reapproval and reacceptance are required after approved/closing restructuring. Old signing callbacks and funding requests cannot revive a previous package.
- After partial funding, a successor package carries funded facilities unchanged and reapproves only the remaining financing against total exposure. Funded-facility edits/merges fail.

Validation record: **Not started.** Include change-after-acceptance, expiry boundaries, lost-response retries and borrower-safe projections. Use L01's legacy funded-facility mappings as fixtures for immutable-funding/successor guards; L09 owns the connected partial-funding flow, avoiding a circular implementation dependency.

## L07 Application clocks and decision notices

**Outcome:** the bank can distinguish workflow progress from dated notice obligations and can explain unsuccessful outcomes.

Use L03's receipt/completeness events plus decision, information-request, offer-response and closure events. Add policy-versioned synthetic notices for incompleteness, approval/counteroffer, decline and other configured outcomes; store specific principal reasons and an immutable borrower-facing artifact separately from private analysis. Deliver through the existing simulated inbox and outbox.

Acceptance criteria:

- Original receipt, completeness, rework, decisions and delivery timestamps remain distinct. Reassignment, resubmission and restructuring cannot erase or silently reset an existing clock.
- Policy can distinguish borrower revenue/application context from loan amount. The demo does not claim one universal 30-day rule or complete legal compliance; statutory/policy due dates and internal SLAs are separate.
- Specific reasons reference the actual human decision. A generic “criteria not met,” a fake check score or a private committee note cannot become a final borrower notice without explicit review.
- Notice due, generated, delivery pending, delivered, failed and superseded states are distinguishable. Retries deduplicate the logical notice; failure remains visible to staff.
- Information requests name missing items and a response date. Offer expiry, withdrawal, decline and incomplete-file closure remain separate recorded outcomes under the chosen policy.
- Existing recipient scope, raw-identifier redaction, current-access checks and synthetic-only delivery remain enforced in both runtimes.

Validation record: **Not started.** Use injected clocks for deadlines/expiry and real PostgreSQL for outbox atomicity, restart/retry, recipient scope and immutable notice evidence.

## L08 Facility closing and collateral clearance

**Outcome:** signed documents and specialist clearance match the accepted, approved structure before any facility can fund.

Extend the current closing service to versioned facility packages and package-wide conditions. Add product templates for entity authority, required equity, guarantees, synthetic lien/title/insurance evidence, program authorization, sources/uses and funding instructions. Conditions name the stage, responsible party, source versions, dependency, expiry and permitted resolution. Distinguish prerequisites from explicitly allowed trailing-file items.

Acceptance criteria:

- Closing uses the current approved and accepted terms. Missing acceptance, expired approval, an amendment hold or unresolved mandatory conditions blocks progression with specific reasons.
- Each facility generates the correct documents/signers; shared conditions are evaluated once at package scope. Replaced terms require new documents and signatures where affected.
- A requested lien filing or pending valuation does not equal clearance. Signed documents alone cannot satisfy collateral, contribution, recipient or program prerequisites.
- Signer portal identity, authority to bind an entity and a personal guarantee are checked independently. Restricted parties cannot inspect other people's guarantees or unrelated facilities.
- Shared collateral and lien priority are explicit across facilities; the same asset is not counted at full available value several times. Unresolved priority/intercreditor needs block applicable release.
- A permitted trailing item has reason, authorized exception, owner and due date. Non-waivable conditions and required signatures cannot become trailing items through a generic waiver.
- Legacy closing packages/signature evidence remain readable. Database uniqueness now reflects facility/package revision while preventing duplicate active packages for the same scope.

Validation record: **Not started.** Extend current signature-staleness and funding-gate regressions, including real PostgreSQL upgrade, rollback and cross-facility access cases.

## L09 Controlled funding for multiple facilities

**Outcome:** the bank can record initial funding per facility with separate release control and accurate package status.

Replace the direct one-application funding shortcut for structured applications with prepare → authorize → execute synthetic release → confirm/reconcile. Keep one initial disbursement event per supported term facility. An event may reference a reconciled allocation to synthetic recipients; this is not repeated draws or servicing. Make simultaneous-close groups explicit: an all-or-nothing synthetic group confirms together, while sequential funding is available only under an approved dependency policy.

Acceptance criteria:

- The funding preparer cannot release their own instruction where separation is configured. Recheck active membership/authority, current terms, accepted offer, signatures, conditions, policy and synthetic recipient confirmation immediately before release.
- Record gross principal, fees/contributions and recipient allocations consistently. First-slice term funding equals that facility's approved initial disbursement; no field is displayed as an outstanding balance.
- The $5M and $4M facilities create separate linked accounts and funding records. The application shows partial versus complete funding from actual confirmed events; it never reports $9M funded after only $5M is confirmed.
- Idempotency and uniqueness are per facility/release group. Repeated/concurrent commands, retries and duplicate callbacks cannot create a second account or double funding. Legacy receipt replay still returns its original account.
- A failed or uncertain simulated attempt creates no confirmed funding/account. Reconcile the same attempt before another release; worker restart and lost response do not initiate a new logical transfer.
- Funding, account linkage, audit, status and outbox commit consistently. A failed transaction leaves no orphan account. An amendment/funding race obeys the common application lock and version guard.
- An unfunded facility can be amended/cancelled only through an authorized successor package. Already funded records remain unchanged; partial withdrawal produces a truthful closed-with-partial-funding summary.
- No external payment, core-banking or lender-settlement call exists. Loan accounts remain summaries of initial funding.

Validation record: **Not started.** Prove atomic groups versus permitted sequential funding, authority separation, rollback, reconciliation, upgrade and concurrent races in real PostgreSQL and both HTTP transports.

## L10 Connected scenarios and hosted acceptance

**Outcome:** demonstrate the expanded bank workflow and preserve existing borrower/access behavior locally and on the hosted demo.

Update the demo kit with distinct synthetic staff responsibilities and product-appropriate financial, collateral and closing fixtures. Use the normal APIs; the kit must not bypass prerequisites or force a credit decision. Browser journeys should inspect what the borrower and each staff role actually see.

| Scenario | Required demonstration |
| --- | --- |
| Small simple credit | $10K conventional request, resumable choice/setup, short memo, delegated human approval, acceptance and funding |
| Medium secured credit | $750K equipment request, evidence review, collateral/guarantee requirements, independent approval and verified vendor instructions |
| Large credit | $7.5M conventional package, aggregate exposure, downside analysis, senior approval and separate release |
| Mixed products | Save $9M SBA preference; restructure to $5M 7(a) plus $4M conventional, review combined repayment, accept and fund each facility |
| Flexible restructuring | Add a third facility, change the total to $8M, replace a product and combine unfunded facilities without resetting setup or losing history |
| Program constraints | Reject $6M single 7(a), unsupported product execution, unknown exposure and generic-waiver attempts; preserve saveable drafts |
| Rework after approval | Amend accepted terms during signing; stale approval/signature/release fails; revised package proceeds after new approval/acceptance |
| Negative outcomes | Specific decline, incomplete-file notice, expiry/nonacceptance and withdrawal remain distinct and notify correctly |
| Partial funding | $5M confirmed and $4M pending is partial; failed/uncertain second attempt reconciles without duplication; funded facility cannot be edited |
| Legacy compatibility | Existing drafts and funded accounts survive upgrade and replay; no old loan is relabelled SBA and no completed setup restarts |
| Access and concurrency | Cross-bank IDs, revoked staff/participants, private guarantees, stale votes and competing restructure/fund commands are denied safely |
| Runtime parity | Five native Worker builds plus an actual hosted mixed-product path, private evidence bytes, synthetic inbox, replay and scoped-denial checks |

Record local and hosted evidence separately, including exact revisions and unverified limitations. Do not mark any preceding task complete solely because this final scenario passed; each owns its critical tests.

Validation record: **Not started.** No expanded lending functionality or deployment was validated by the research task.

## Decisions to confirm during implementation

Use the proposed defaults for synthetic demonstrations; they do not block L01. Record material deviations in [decisions](../06-decisions-and-sources.md) and adjust dependent acceptance criteria.

| Choice | Proposed starting point | Revisit when |
| --- | --- | --- |
| Initial executable catalog | Three term-loan families; other entries reference-only | Enabling another product |
| Size routing | Configured $250K/$2M illustration plus complexity/exposure escalation | L03 policy fixtures |
| Approval authority | Small delegated, medium independent reviewer, large configured joint approvals; no admin bypass | L05 authority fixtures |
| Amendment invalidation | Reapprove/reaccept the whole unfunded package after any material change | Optimizing evidence/approval reuse |
| Funding sequencing | Explicit simultaneous-close group or permitted sequential policy; no implicit partial release | L08/L09 |
| Additional disbursements | One initial confirmed event per supported term facility | A separate draw/servicing plan |

Documentation validation belongs to [R01](../tasks/R01-lending-workflow-research.md); implementation status belongs to these task records and the [plan index](../README.md).
