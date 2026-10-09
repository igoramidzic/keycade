# Product scope and user journeys

The [v2 screenshot-driven update](v2/README.md) is the current product direction, planned on October 8, 2026. V2-01–V2-06 setup, borrower dashboard, demo importer, document review, lender overview and Loan Footprint are implemented and verified locally; V2-07 integrated local acceptance is complete; V2-08 hosted parity is complete. The detailed [experience specification](v2/02-experience-spec.md) and [screenshot findings](v2/01-screenshot-findings.md) distinguish observed reference behavior from decisions for Keycade. Existing task validation records describe the implemented baseline; they do not establish v2 acceptance.

## Product intent

Keycade helps banks originate business credit and coordinate the work required from applicants, beneficial owners, outside advisers, and bank staff. Borrowers get a clear next action; bank staff get the application record, requirements, documents, check results, and history in one workspace.

The first implementation operates as one fictional bank. Model bank boundaries from the start and test with a second isolated bank. Do not build bank onboarding, billing, or a tenant administration product yet.

## First-release boundaries

Included:

- Three web applications: mock bank site, borrower portal, and bank console.
- Email-first applications and passwordless resume links; no password creation.
- Required initial setup wizard with one simple question per screen, persisted progress, and resume before entering the application's task portal.
- Business profiles, term-loan and credit-facility application types, multiple applications, and funded-account summaries.
- Applicant-created and staff-created applications through one backend use case.
- Owners and advisers with explicit application/task/document permissions.
- Bank-defined example product requirements, manual tasks, evidence review, and progress.
- Drag-and-drop and accessible file-picker uploads from both workspaces.
- Delayed simulated OCR/classification, business/tax lookups, identity/fraud checks, signatures, and notifications.
- Human review, decision, closing conditions, and recorded simulated funding.

Deferred: repayment schedules, interest/accrual accounting, principal balances, draws and repayments, payment rails, delinquency, collections, statements, loan transfers, real underwriting models, a configurable workflow designer, full bank SSO, a public partner API, production hosting, and live vendor integrations. A funded account displays the original funded amount, not a computed outstanding balance.

## People and responsibilities

| Persona | Primary actions |
| --- | --- |
| Applicant administrator | Start/resume an application, record business owners, supply business information, submit for review. Ask the lender to invite collaborators. |
| Beneficial owner | Supply their own requested information and perform assigned actions; ownership alone grants no portal access. |
| External adviser | Perform explicitly assigned tasks and upload/view explicitly permitted evidence. Examples: lawyer or accountant. |
| Loan officer | Create applications for clients, assign staff, invite participants, request information, review evidence, record decisions and funding. |
| Bank administrator | Manage local bank staff membership and product fixtures/configuration; no cross-bank privileges. A full admin UI is deferred. |

One person may have several roles across applications. Never infer access from a shared email domain, business name, tax ID, or ownership percentage.

## Main journeys

### Start with the mock bank

1. A fictional bank homepage offers “Apply for business financing” and “Continue an application.” Its apply link supplies a public bank slug and optional product hint, never credentials.
2. The borrower app asks for email first. Starting an application records a provisional contact and a draft application, even before business details exist; generic sign-in or resume alone never creates an application.
3. Authenticate through T06. The explicitly enabled local demo uses immediate, visibly labelled demo sign-in for synthetic users; the email-link path sends a single-use link to the local inbox and verifies email before granting access. Both paths enforce application participation. Anonymous users never see existing applications.
4. Open a dedicated initial setup page, before the task portal. The v2 wizard collects the business legal name, structured business address, requested amount, illustrated multi-select funding purposes, optional business taxpayer identification number, optional website, and optional industry. Keep one logical question per screen: the address's constituent fields form one address question, and purpose choices form one multi-select question. Save each answer and the current step; show progress and explicit save errors. Synthetic Business Credit is assigned automatically; there is no product-selection question or change action.
5. Business EIN/TIN and website can be explicitly skipped. The optional business identifier uses a narrowly authorized, encrypted setup command and only registered synthetic values; it never belongs in general setup answers, logs, or ordinary response JSON. SSN is not collected during setup. Missing identifiers may still become later authorized private tasks when the configured product requires them.
6. “Continue later” is always available and explains which progress has been saved. Returning after sign-in or through a fresh link restores the saved setup step and answers for the same application. Only an explicit, successful “Finish setup” action opens that application's portal with its remaining tasks.

Do not require users to know their industry code. Interpret the user's “NEX code” as NAICS, offer an in-picker searchable combobox with hundreds of NAICS entries, fuzzy plain-language/synonym matching (such as “dentistry office”), and allow “I don't know.” T15 supplies the implemented versioned catalog and source evaluation. Save the explicitly selected code plus taxonomy version, or an unresolved value to be completed later. Keep setup question screens concise: question, field, useful product range, and actions; omit routine helper/save-success paragraphs.

V2 retains the implemented searchable 2022 NAICS catalog and optional industry selection. Display the selected NAICS code and title in the industry question, final setup review and business summary; keep the website question separate. Accept bare website domains and normalize them to HTTPS; “NAICS score” in the new request means an industry code, not a risk score. A website never silently selects an industry or triggers a live lookup. The funding-purpose screen replaces the free-text primary input with illustrated, accessible multi-select options and stable saved identifiers. The [experience specification](v2/02-experience-spec.md) defines the selection and review behavior.

### Initial setup wizard and portal entry

The wizard is the applicant's required entry experience for each new loan application. Keep it focused on one question at a time, with plain-language prompts, Back/Continue controls, a clear step indicator, and an explicit skip action for optional questions. A final summary allows corrections before “Finish setup.” Setup progress describes these questions only; it is separate from the portal's remaining-task progress and is never an approval probability.

Persist answers, current step, completed/skipped steps, and completion state in the database against the application. Resume must work after refresh, sign-out, browser storage loss, an expired original link, or a new device. A failed save keeps entered values visible and retryable; do not advance persisted progress or claim completion until the server acknowledges it. Back navigation restores saved answers, and edits revalidate any dependent answers. Each question has its own address (for example `/applications/:id/setup/amount`), so reloading reopens that question; browser back/forward may move only among questions already reached, and every step change scrolls to the top. Requested amounts are entered as whole dollars with comma separators.

The server validates all required initial answers and records completion atomically and idempotently. Signing in, creating a draft, pre-filling fields, or navigating directly to a portal URL does not finish setup. Until completion, applicant routes return to the wizard and backend guards block applicant operations that require the task portal. Once complete, the portal becomes the normal return destination and shows outstanding information, documents, signatures, and other permitted tasks. Finishing setup does not submit an application, approve credit, or create a funded loan account; evidence collection, checks, personal identifiers, and any outstanding business-identifier requirement remain later tasks.

Version the v2 setup definition and migrate unfinished drafts without losing acknowledged answers or their resume destination. Preserve legacy purpose text for review; never guess multi-select choices from it. Completed legacy applications stay completed and are not sent back through setup. Collect any newly needed information through explicit, authorized follow-up work.

This gate belongs to each application, not the user account or business. A minimal application selector may offer “Continue setup” for unfinished drafts and “Open application” for completed setups. An unfinished new application does not block access to another completed application. Staff may inspect and prefill drafts before setup finishes; a staff-created draft still requires the applicant to confirm its initial answers and finish setup. Invited owners/advisers follow their scoped invitation/task journeys and are not asked to complete the applicant's wizard or granted broader access by it.

### Work across applications

After initial setup, the borrower home lists applications and funded accounts grouped by business. Each card identifies business, product, amount, state, last update, and outstanding action count where available. Unfinished drafts show setup progress and “Continue setup,” which opens the saved wizard step rather than that application's task workspace. A person with access to only one task sees a limited card and workspace. Selecting one application must not merge its documents or tasks with another.

The planned v2 application dashboard has no top-level application tabs. Show tasks in the main left column and application details, stage/progress, and a working document drop zone/file picker in the right column. On mobile, stack the same accessible regions. Progress is derived from applicable requirements, can change when requirements change, and is not an approval probability. The red top area in the reference identifies the client experience; use the [Keycade design system](06-decisions-and-sources.md#design-system-redesign--october-8-2026) rather than copying reference branding.

Retain permitted document, signature, submission, closing, people, activity, and funded-account actions through relevant task details, sidebar actions, and contextual routes. Removing tabs does not remove these capabilities or expand access. Preserve legacy deep links with authorized redirects or contextual screens and protect unsaved task answers. Restricted collaborators see only their permitted work and appropriately limited summaries. Invitation controls remain lender-only.

### Collaborate with an owner or adviser

Only bank staff invite a named role into an application, from its Participants view in the lender console. The client dashboard has no invitation controls, and client API requests to create, resend or revoke invitations are denied. Show the role, scope and selected tasks before sending. Selected unfinished tasks become the recipient’s assignments atomically when they accept; pending invitations grant no access. If a selected task changes while the invitation is pending, require the lender to review it and issue a new invitation. The recipient verifies the invited email and accepts. A lawyer defaults to assigned tasks and their permitted documents. An owner can provide personal identifiers without exposing them to every collaborator. Pending, accepted, expired, and revoked invitations are distinct.

Staff can add participants to an existing application. Recording a business ownership relationship and granting portal access are separate actions.

### Bank staff manage the pipeline

The bank console lists applications with search, stage/assignee/product filters, pagination, next-action counts, and processing indicators. Staff can create an application on behalf of a client, assign an officer, inspect evidence and checks, add tasks/participants, and request missing information.

For an officer-started application, the signed-in bank determines the tenant. Borrower email is the minimum required input; business name, requested amount and purpose are optional prefills. **Create and invite borrower** saves the draft and supplied details together with one simulated continuation request. Invalid supplied details save no draft or invitation; retrying the same request recovers the same application. The borrower opens that application's saved setup, confirms any prefills and completes missing questions before entering its task portal. An officer cannot finish this confirmation on the borrower's behalf. Staff and borrowers work on the same application through their separately authorized views; internal notes and staff-only operations remain private to the bank.

This application handoff belongs to loan origination. Ongoing servicing after funding remains deferred under the first-release boundaries above.

The planned v2 lender application detail retains top-level tabs. Its landing overview presents business and loan details, financial summaries such as revenue and adjusted net income, application stage, outstanding work, and completed items. Distinguish actionable tasks from evidence groups and recorded checks: “Business tax returns (3)” opens the three permitted documents, rather than creating three additional tasks. Financial values show their period, source and review status; unknown values stay unknown. Staff-only notes and analysis never appear in borrower responses. Keep the participant list, task review, checks, notes, activity and existing decision/closing controls reachable from the lender workspace.

### Upload and understand documents

An authorized user selects an application and uploads with drag-and-drop or a file picker. Default prototype limits are PDF/JPEG/PNG, 25 MiB per file, up to 10 files per batch; configure rather than duplicate limits. These are product defaults, not vendor requirements.

Show upload progress, scanning, processing, categorized/needs-review, and recoverable failure separately. Group documents into Tax documents, Bank statements, Financial statements, Business/legal, Identification, Signed documents, and Other. Preserve original names and versions. Simulated extracted fields are suggestions requiring review; classification alone does not complete a task.

In v2, selecting a lender document opens a split modal with the original document preview on the left and document information, simulated analysis/extracted fields, and version history on the right. Preserve downloadable originals and useful preview-error states. An authorized staff reviewer may explicitly adopt selected extracted financial facts into this application's record after reviewing their sources. Never silently overwrite confirmed values, change another application, complete a task, or decide credit because a mock analysis ran. See [data and simulation contracts](v2/03-data-and-simulation.md).

The planned protected demo importer accepts registered text-file names that select synthetic tax-return or bank-statement fixtures. It generates the corresponding synthetic PDF and sends it through the normal authenticated upload, quarantine and processing path. Unknown names produce a clear unsupported/unknown outcome. Ordinary PDF/JPEG/PNG upload behavior remains content-bound; a filename cannot force a scan, permission, credit decision, or funding result. No real OCR or analysis service is introduced.

### Geographic eligibility — planned v2

The lender's loan-footprint item opens an accessible modal with a mock map and the application's business address. A valid U.S. address produces a visibly simulated green result; a non-U.S. address is not clear, and missing or invalid location data stays unknown. Address edits invalidate the prior result. Do not perform live geocoding or add a new submission/approval/funding gate by default. The demonstration makes no real geographic or credit determination.

### Review, close, and fund

Once submission requirements are satisfied, the applicant submits. Bank staff can request additional information, approve, or decline with a recorded reason. A simulated warning cannot autonomously decide a loan. Approval can create closing tasks and signature requests. Staff record funding only after closing gates pass; doing so creates a linked funded loan account exactly once.

Every demo labels provider results and funding as simulated. No first-release action transfers money.

## Amounts and products

Use USD initially and exact monetary values. Test $10,000, $5,000,000, and $7,500,000. These are coverage examples, not hard lending limits or a definition of business size. Product configuration supplies any minimum/maximum and requirements; never scatter thresholds through components.

Provide sample small-business and commercial requirement templates. Requirements can depend on product, amount, entity type, owners, and supplied information. Unknown information produces an explicit information task rather than a made-up fact. Persist the applied rules version. Template changes must not silently rewrite previously reviewed decisions.

## UI expectations

Use shadcn components generated by its CLI and Tailwind, themed by the Keycade design system that the user requested on October 8, 2026 ([decision](06-decisions-and-sources.md#design-system-redesign--october-8-2026), [D06](tasks/D06-design-system-redesign.md), [shared UI guide](../../packages/ui/README.md#design-system)). Prefer straightforward forms, cards, tables, tabs, badges, dialogs, alerts, and accessible status messages. Keep borrower screens calm and client-focused, keep lender screens dense but scannable, and never imitate a real institution's branding.

Support keyboard navigation and mobile borrower layouts. Do not rely on color alone, a drag gesture alone, or toast messages alone. Preserve entered values on errors. Show useful empty, loading, denied, expired-link, failed-upload, and retry states. Poll for asynchronous changes initially; a WebSocket service is unnecessary.

## Demo behavior in every environment

The complete app is a demo, including its production URL. Hosted sign-in, invitations, reminders and signing must be usable with simulated access and delivery as on local, without real email or authentication providers. All identities, records, checks, signatures and funding remain synthetic and visibly labelled. Backend authorization still applies between banks, applications and restricted resources. The current hosted delivery error is tracked in [D03](tasks/D03-hosted-demo-parity.md).
