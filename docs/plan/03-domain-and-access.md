# Domain, lifecycle, and access rules

This is the target model, not a requirement to create every table in T03. Add each feature's records and migration in its owning task.

The [v2 data contracts](v2/03-data-and-simulation.md) were planned on October 8, 2026; V2-01–V2-06 data contracts are implemented locally; integrated and hosted acceptance remain V2-07/V2-08. They extend the validated baseline with versioned setup fields, reviewed application financial facts, evidence projections and simulated geography; see [delivery and validation](v2/04-delivery-and-validation.md).

## Core entities

| Entity | Responsibility and key relationships |
| --- | --- |
| Bank | Tenant boundary, public slug, name, local product configuration. |
| User / ApplicantContact | Verified identity versus a provisional email contact. Starting a lead does not verify or authenticate someone. |
| Session / LoginToken | Revocable session and hashed, expiring, single-use email credential. |
| BankMembership | Explicit staff role for one bank; distinct from application participation. |
| Business | Applicant business belonging to one bank; may have many applications. A draft can initially have no business. |
| BusinessRelationship | Person's owner/contact relationship and optional ownership percentage. Does not grant login or access. |
| LoanProduct / RequirementSet | Versioned demo product and rules determining applicable information and tasks. |
| Application | Bank, optional business, contact, product, requested amount, purpose, source, lifecycle, assigned staff, revision. |
| ApplicationSetup | Per-application wizard state, step-definition version, current step, completed/skipped step keys, revision, and completion actor/time; initial answers use the application's canonical fields. |
| ApplicationParticipant / Invitation | Verified application access and permitted scope; email invitation is a pending grant. |
| Task | Stable requirement key or manual task, assignee, stage, visibility, evidence, due date, revision, review result. |
| Document / DocumentVersion | Application-specific artifact and immutable uploaded versions, uploader, private storage key, scan/processing state. |
| TaskEvidence | Links a specific document version, answer, or signature result to a task. No copying files to satisfy two tasks. |
| SensitiveIdentifier | Encrypted identifier for its business/person, masked display, type, revision, limited access. |
| IntegrationRun / CheckResult | Provider operation, input revision, attempts, execution status, separately typed outcome. |
| SignatureEnvelope / Signer | Specific document version, intended verified signers, provider references, signed artifacts and events. |
| Decision / ClosingCondition | Human-authored review result, reason, input snapshot, approved terms, and closing requirements. |
| FundingRecord / LoanAccount | Explicit funded amount/date/reference and linked account, created only by the funding use case. |
| OutboxEvent / Notification | Durable work intent and deduplicated delivery/suppression state. |
| AuditEvent / ActivityProjection | Detailed safe internal event versus the filtered, human-readable history visible to each actor. |

Every business record is bank-scoped. Tenant-bearing relationships must prevent cross-bank links with composite constraints or equivalent validated transactional checks. Test these invariants in the database as well as in routes. A single global user may participate in several banks, but user identity never implies permission in them.

Use an explicit application participant grant for every non-staff reader. Do not automatically share all applications of a business. Initially a document belongs to one application; cross-application document reuse is deferred.

## Initial setup state and completion

Every new application starts with setup `in_progress`, including staff-created drafts. Assign the bank’s latest active Synthetic Business Credit (`business-credit`) version on creation; clients cannot select another product or change an assigned version. Retain product/version storage for configured limits and historical requirements, not borrower choice. Legacy `product` step keys resolve to `amount` in the current wizard. Persist the step-definition version, stable current-step key, completed/skipped steps, and an optimistic revision alongside canonical answers. Save answers and progress transactionally; optional skips are explicit, required questions cannot be skipped, and changed answers invalidate dependent step validation where needed. Resume reads this server state after authorization, never just a browser step index. Use committed migrations and synthetic fixtures in T07.

An applicant administrator explicitly finishes setup through a revision-checked, idempotent domain command. Validate required answers against the application's setup-definition version and product configuration. The v2 definition requires business legal name, structured business address, the fixed product, exact requested amount, and at least one valid funding-purpose selection; website, business EIN/TIN, and industry may remain unresolved. Record `completed`, actor/time, audit and any job intent in the same transaction as the transition to `collecting_information`. Pre-filled staff answers still require applicant confirmation. Failed saves, invalid answers, and concurrent stale completion requests cannot partially complete setup.

Until completion, an authorized applicant may read a minimal summary, save/resume setup, or withdraw, but cannot enter that application's task workspace or invoke applicant portal operations such as task/evidence submission or application submission. Enforce the prerequisite in domain/API guards as well as route handling. Completing setup grants no new participation or document permissions. Staff retain authorized draft access; invited owners/advisers retain their separate assigned scope without completing someone else's setup.

Setup completion is independent of task readiness and later review. New requirements do not send an applicant back through the initial wizard, and ordinary permitted edits after setup use the portal's validation and lifecycle guards. Each new application requires its own setup, even for an existing business; another application's completion cannot satisfy it. Withdrawn or otherwise inaccessible drafts use closed/denied states rather than an endless setup redirect.

V2 preserves completed legacy setup records and their historical definition; it does not apply new required fields retroactively to portal entry. Upgrade unfinished drafts with explicit stable step mappings, preserved saved values and reviewable legacy purpose text. Keep structured purpose IDs separate from the historical free-text value; do not infer selections from text. Persist address components including country, and store an optional validated website independently from the selected NAICS code/title and taxonomy version. NAICS is a classification code, not a score; a website cannot select it automatically.

Optional business EIN/TIN capture during v2 setup is a narrow exception to the general pre-setup portal restriction. Permit only the current authorized applicant administrator for that application, or staff within their authorized draft workflow, to write a registered synthetic business identifier through encrypted identifier storage. This command exposes only presence, mask and revision, respects lifecycle/revision/idempotency rules, and grants no personal-identifier, tax-request, task, document or general enrichment access. Skipping it cannot block setup and never records tax authorization implicitly. No SSN setup question or raw-identifier read endpoint is added.

## Application lifecycle

“Ready to submit” is derived from requirements and checks. It is not a mutable status that can disagree with evidence.

| From | To | Actor and guard |
| --- | --- | --- |
| New lead | `draft` | Public email-start or authorized staff creation; bank/product valid; idempotent. |
| `draft` | `collecting_information` | Authorized applicant administrator explicitly finishes initial setup; server validates required answers and records setup completion atomically. T06's permitted synthetic demo actor may do this without claiming verified email. Staff prefill alone does not complete setup. |
| `collecting_information`, `needs_information` | `submitted` | Applicant administrator or staff explicitly submitting on behalf; submission gates pass; record submitting actor and current snapshot. |
| `submitted` | `in_review` | Bank staff claims/starts review. |
| `in_review` | `needs_information` | Bank staff records a reason and opens/returns relevant tasks. |
| `in_review` | `approved`, `declined` | Bank staff records a reason and terms where applicable; approval gates pass against current versions. |
| `approved` | `closing` | Staff starts closing against the approved snapshot; create closing conditions idempotently. |
| `closing` | `funded` | Staff records simulated funding after all closing gates pass; one linked account. |
| Any nonterminal state above | `withdrawn` | Applicant administrator or authorized staff, with reason; cancel pending reminders/work that no longer applies. |

`funded`, `declined`, and `withdrawn` are terminal in this release. A new request uses a new application. Material applicant edits are allowed in `draft`, `collecting_information`, and `needs_information`; submitted/reviewed/approved snapshots are locked. Staff returns an in-review application to `needs_information` to request edits. Reopening approved or closing terms is deferred; do not silently mutate them. Closing-specific tasks remain editable in `closing`.

Each submission freezes its application facts, business facts, applicable requirements, and references to specific identifier/document/check versions. A shared business profile is a source for editable drafts, not a live pointer that rewrites submitted facts. Editing that profile through application B must not change application A's submission/decision inputs or reveal A's existence. Drafts explicitly adopt newer shared facts with revision checks. Sensitive snapshots use encrypted version references rather than copying raw identifiers into ordinary JSON.

Application status is independent from upload, job, task, and signature states. An OCR failure does not change the entire application to a nonexistent “failed” status.

## V2 evidence groups and reviewed financial facts — implemented locally

An evidence group is an authorized projection over documents, their current versions and related work, not a new task state. A group containing three tax returns reports three permitted documents; version history does not inflate the count. Completion of a related requirement remains governed by task evidence review. Group counts, modal reads and historical versions must not expose another bank, application or restricted participant's evidence.

Keep typed extracted financial suggestions separate from confirmed application facts. A financial fact identifies its metric, period, decimal-string amount and currency; revenue/sales and adjusted net income must retain distinct meanings. Unknown values are null/absent, not zero. Do not sum multi-year returns or invent an adjusted-net-income formula from the screenshot. The lender view distinguishes suggested, reviewed and stale data and shows source/period.

Only an authorized staff reviewer explicitly adopting selected current suggestions can create a reviewed application financial-fact revision. Bind each adoption to bank/application, document ID and immutable version, processing run, selected field, period, currency, source input revision, adopting actor and time. Recheck clean/current source state, access, editable application lifecycle and expected record revision transactionally; conflicting sources or changed values require deliberate review. Preserve previous facts and source history. Replacement/reprocessing can mark a source stale but cannot silently erase or replace a reviewed fact. Repeated commands are idempotent, and stale results cannot become current.

Financial adoption does not complete requirements, approve credit, change a decision/funding event, or rewrite shared business/client records and other applications. Submitted and decided snapshots remain immutable under the existing lifecycle policy. Any future shared-record promotion requires a separately scoped command; it is not part of this v2 adoption flow.

## V2 geographic eligibility — implemented locally

Bind the simulated loan-footprint result to the application's current structured address revision and fixture/rule version. A valid U.S. address is clear for this demo, non-U.S. is not clear, and missing/invalid data is unknown. Persist or derive explicit freshness so an address edit cannot leave a former green result appearing current. The map is a synthetic display of the same authorized address, not evidence of a live lookup. This is an informational lender item by default: it introduces no automatic credit decision and no new submission, approval or funding gate.

## Tasks and requirements

Task states: `open`, `submitted`, `needs_changes`, `completed`, `waived`, `cancelled`. An authorized assignee submits evidence. A bank reviewer completes or returns it. A staff waiver requires a reason. System completion is permitted only for documented deterministic rules such as all intended signers finishing the required envelope; a generic AI confidence score is not such a rule.

Requirements have stable keys, stage (`submission`, `approval`, `closing`), required/optional status, rule version, reason, visibility, and relevant input revision. Include the subject in each key, such as requirement type + owner ID, so two owners receive separate tasks. Reconcile rules idempotently when relevant facts change. Create new requirements once, preserve manual tasks and completed history, and mark no-longer-applicable requirements cancelled with an explanation. Do not silently delete evidence or undo a staff waiver.

Material evidence changes reopen affected completion or mark it stale for review according to a documented rule. An officer explicitly re-evaluates a revised rule set; a product edit does not retroactively rewrite an application's pinned rule version. Missing identifiers can create a later-stage task without blocking the short initial application.

If a cancelled requirement becomes applicable again, reactivate its stable requirement identity with a new occurrence/revision and preserve prior history. It starts open unless an explicit reuse policy proves that the same current evidence still satisfies it. A waiver is scoped to its requirement occurrence and policy version; reactivation requires renewed reviewer confirmation rather than silently reusing it. Test amount changes and owner removal/re-addition, not just the first rule evaluation.

For a target gate, evaluate all active mandatory requirements/checks assigned to that stage or an earlier stage. Optional or later-stage items do not block it. A task passes only with current completed evidence or an allowed audited waiver. A required check passes only with a current successful execution and a clear outcome, or an explicit policy-permitted staff resolution; a resolution preserves the original finding. Waiting, failed, running, stale, and unresolved review outcomes block their assigned gate. Submission additionally requires completed initial setup, verified authority, and valid initial business/product/amount fields; approval requires an in-review application and a human decision; funding requires closing and current approved terms/signatures. Do not make every known identifier/check a submission prerequisite by default.

## Independent processing states

- File scanning: `pending`, `clean`, `blocked`, `error`. Unscanned or blocked content is quarantined and unavailable for normal download/ingestion.
- Document interpretation: `queued`, `processing`, `classified`, `needs_review`, `failed`. Unknown content remains visible as a record and can be reviewed/reprocessed after a clean scan.
- Integration execution: `waiting_for_input`, `queued`, `running`, `succeeded`, `retry_scheduled`, `failed`, `timed_out`, `cancelled`.
- Check outcome: `clear`, `needs_review`, `unable_to_verify`, or provider-specific typed findings. A successfully executed fraud check may still have `needs_review` as its outcome.
- Signature envelope: `draft`, `sent`, `partially_signed`, `completed`, `declined`, `expired`, `voided`. One signer completing does not complete a multi-signer envelope.

## Access matrix

All rows assume the same bank and an authorized application scope. “Assigned scope” means the intersection of the actor's current grant, task visibility, and document permissions.

| Action/data | Applicant administrator | Invited owner | External adviser | Bank staff |
| --- | --- | --- | --- | --- |
| Application summary | Granted applications | Granted application summary | Limited granted summary | Bank applications |
| Business form edits | Editable lifecycle stages | Explicitly assigned fields | Explicitly assigned fields | Bank-authorized workflow |
| Create/resend/revoke invitations | No | No | No | Yes within bank |
| Owner relationship summary | Own application | Own relationship; others only if granted | No by default | Yes within bank |
| Personal identifier entry | Own personal data; authorized business EIN | Own personal data | No by default | Designated staff workflow |
| Read raw personal identifiers | No general raw-read endpoint | No general raw-read endpoint | No | Restricted server-side provider workflow; UI masked |
| Upload files | Permitted application tasks/docs | Assigned scope | Assigned scope | Bank-authorized application |
| Read files | Shared application docs; not another person's private identity evidence | Assigned scope | Assigned scope | Authorized bank scope |
| Review/waive requirements | No | No | No | Yes, with reason/audit |
| Internal notes/check evidence | No | No | No | Yes |
| Submit application | Yes | No by default | No | On behalf, explicitly recorded |
| Approve/decline/fund | No | No | No | Demo officer/admin role |

The prototype gives active bank officers bank-wide application access; assignee is a workflow field, not a security boundary. Bank administrators additionally manage staff membership through seed/admin tooling. More granular staff teams and separate approval authority limits are later product decisions.

Authorization applies to lists, counts, search, activity, direct record URLs, API calls, uploads, downloads, exports, retries, and subscriptions/polling. Reject cross-application evidence links. Enforce current membership on every request, including requests from sessions created before revocation. Do not issue durable public document URLs.

## Identity and invitations

Demo access in every environment (October 7 clarification, superseding the October 6 local-only restriction): an explicitly enabled demo endpoint accepts an email and creates a session immediately, solely for synthetic users/banks. It records `authenticationMethod=demo`, never marks mailbox ownership verified, and scopes the actor to the selected demo bank. Current application grants and staff membership still apply. Hosted production is also a demo and uses the simulated access/delivery behavior verified in [D03](tasks/D03-hosted-demo-parity.md). The rules below continue to govern email-link verification and invitations within the simulation; the override does not auto-accept invitations or grant roles.

- Email-start creates a pending contact/draft and sends a link; it reveals neither existing accounts nor application details. Creating another lead with the same email does not grant access or merge businesses.
- Store only token hashes, use cryptographically random credentials, set expiry and single-use semantics, and consume links transactionally. A GET displays a confirmation page; a deliberate POST consumes the token so email scanners do not exhaust it.
- Queue only an access-delivery request ID. The worker generates the raw credential in memory at delivery time, commits its hash/expiry/purpose/target, then sends it. No plaintext credential belongs in application tables, outbox/queue records, logs, or test reports. The local inbox necessarily contains the emailed bearer link and is development-only.
- If delivery crashes or becomes ambiguous, a retry may issue a new token for the same request. Tokens for that request share one consumption record: any one successful consumption invalidates its siblings atomically. A retry skips an already consumed/revoked request. Previously sent siblings remain valid only until their normal expiry or that shared consumption/revocation, avoiding a broken link after an SMTP-accepted crash.
- Use server-side, revocable sessions in HttpOnly cookies. Apply Secure cookies outside local HTTP development, SameSite settings, origin/CSRF protection, login/send rate limits, and approved return destinations.
- Normalize email consistently without provider-specific assumptions such as removing dots or plus suffixes. Verify the exact invited address according to that normalization.
- An invitation contains bank, application, role, scope, inviter, recipient, expiry, status, and optional task-assignment intent with expected revisions. Acceptance grants only that scope and cannot grant staff permissions.
- Check delegation authority both at invitation creation and acceptance. If the inviter lost authority or the grant is no longer valid, invalidate/reissue the invitation through a current authorized actor. Only current bank staff may initiate or renew invitations; pre-existing borrower-created pending invitations cannot be accepted unless reissued by staff. Scope can never expand to another person's private evidence.
- Lender-selected unfinished tasks are assigned in the acceptance transaction with assignment history, audit and notification intent. Validate bank/application, current privacy, task state and revision again; changed tasks prevent the entire acceptance. Concurrent/replayed acceptance cannot assign twice. Existing visibility-only task grants retain their meaning. Private owner linking and intended-signer workflows remain separate.
- Removing a participant immediately denies future access through existing sessions. Remove their assignments or mark them unassigned for staff attention. Preserve audit and evidence authorship.
- Repeated creation requests with the same idempotency key and payload return the same logical result. A changed payload for that key is a conflict. Use a new key for an intentional second application.

“Continue an application” requests authentication and never creates an application. After verifying email in the selected bank, resolve an allowed target draft if one was recorded; otherwise list existing grants and pending borrower/contact drafts addressed to that verified email for explicit selection/claim. A claim is idempotent and restricted to that recipient and bank. Do not infer other business access or accept role-specific invitations through generic resume. Test loss of the original link/browser and multiple pending drafts for one email.

After resolving an authorized application, route the applicant to its saved setup step when setup is incomplete and to its portal when complete. Re-evaluate current setup state even for old continuation links or direct portal URLs. The explicitly enabled local demo path uses its synthetic actor/grants without asserting mailbox verification; the same setup completion prerequisite applies.

## Data integrity and privacy

Use decimal-string money, explicit USD currency, UTC dates/timestamps, and optimistic revisions. Do not infer an actual repayment balance from the funded amount. Never merge businesses on names alone.

Encrypt stored EIN/SSN values using authenticated encryption behind a server-side interface; the prototype uses generated local keys and synthetic values. General DTOs expose only presence and masking. Real-data handling and production key management remain separate work.

Audit consequential changes with actor/system identity, bank, application, action, target, safe changed-field metadata, correlation ID, and timestamp. Never put raw identifiers, auth tokens, file contents, or provider secrets in event payloads. Audit records are append-only through application interfaces; the prototype does not claim external tamper-proof storage.
