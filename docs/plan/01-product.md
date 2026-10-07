# Product scope and user journeys

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
| Applicant administrator | Start/resume an application, manage permitted collaborators, supply business information, submit for review. |
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
4. Open a dedicated initial setup page, before the task portal. Walk through business name, requested amount, purpose, product selection when needed, and optional industry as separate, simple questions, one per screen. Save each answer and the current step; show progress and explicit save errors.
5. EIN and SSN are not entry requirements. Collect them later, only in an authorized, private task when the configured product needs them. A business may initially have an unknown EIN.
6. “Continue later” is always available and explains which progress has been saved. Returning after sign-in or through a fresh link restores the saved setup step and answers for the same application. Only an explicit, successful “Finish setup” action opens that application's portal with its remaining tasks.

Do not require users to know their industry code. Interpret the user's “NEX code” as NAICS, offer plain-language search, and allow “I don't know.” Save the selected code plus taxonomy version, or an unresolved value to be completed later.

### Initial setup wizard and portal entry

The wizard is the applicant's required entry experience for each new loan application. Keep it focused on one question at a time, with plain-language prompts, Back/Continue controls, a clear step indicator, and an explicit skip action for optional questions. A final summary allows corrections before “Finish setup.” Setup progress describes these questions only; it is separate from the portal's remaining-task progress and is never an approval probability.

Persist answers, current step, completed/skipped steps, and completion state in the database against the application. Resume must work after refresh, sign-out, browser storage loss, an expired original link, or a new device. A failed save keeps entered values visible and retryable; do not advance persisted progress or claim completion until the server acknowledges it. Back navigation restores saved answers, and edits revalidate any dependent answers.

The server validates all required initial answers and records completion atomically and idempotently. Signing in, creating a draft, pre-filling fields, or navigating directly to a portal URL does not finish setup. Until completion, applicant routes return to the wizard and backend guards block applicant operations that require the task portal. Once complete, the portal becomes the normal return destination and shows outstanding information, documents, signatures, and other permitted tasks as those features are implemented. Finishing setup does not submit an application, approve credit, or create a funded loan account; EIN, SSN, evidence collection, and checks remain later tasks.

This gate belongs to each application, not the user account or business. A minimal application selector may offer “Continue setup” for unfinished drafts and “Open application” for completed setups. An unfinished new application does not block access to another completed application. Staff may inspect and prefill drafts before setup finishes; a staff-created draft still requires the applicant to confirm its initial answers and finish setup. Invited owners/advisers follow their scoped invitation/task journeys and are not asked to complete the applicant's wizard or granted broader access by it.

### Work across applications

After initial setup, the borrower home lists applications and funded accounts grouped by business. Each card identifies business, product, amount, state, last update, and outstanding action count where available. Unfinished drafts show setup progress and “Continue setup,” which opens the saved wizard step rather than that application's task workspace. A person with access to only one task sees a limited card and workspace. Selecting one application must not merge its documents or tasks with another.

Application detail has Overview, Tasks, Documents, People, and Activity views. Show a simple status explanation and the most useful next action. Progress is derived from applicable requirements, and can change when new requirements are added; it is not an approval probability.

### Collaborate with an owner or adviser

An applicant administrator or bank staff member invites a named role into one application. Show the scope before sending. The recipient verifies the invited email and accepts. A lawyer defaults to assigned tasks and their permitted documents. An owner can provide personal identifiers without exposing them to every collaborator. Pending, accepted, expired, and revoked invitations are distinct.

Staff can add participants to an existing application. Recording a business ownership relationship and granting portal access are separate actions.

### Bank staff manage the pipeline

The bank console lists applications with search, stage/assignee/product filters, pagination, next-action counts, and processing indicators. Staff can create an application on behalf of a client, assign an officer, inspect evidence and checks, add tasks/participants, and request missing information.

Application detail presents the business, requested terms, participant list, task review queue, document groups, internal checks, staff notes, and activity. Staff-only notes and risk evidence never appear in borrower responses.

### Upload and understand documents

An authorized user selects an application and uploads with drag-and-drop or a file picker. Default prototype limits are PDF/JPEG/PNG, 25 MiB per file, up to 10 files per batch; configure rather than duplicate limits. These are product defaults, not vendor requirements.

Show upload progress, scanning, processing, categorized/needs-review, and recoverable failure separately. Group documents into Tax documents, Bank statements, Financial statements, Business/legal, Identification, Signed documents, and Other. Preserve original names and versions. Simulated extracted fields are suggestions requiring review; classification alone does not complete a task.

### Review, close, and fund

Once submission requirements are satisfied, the applicant submits. Bank staff can request additional information, approve, or decline with a recorded reason. A simulated warning cannot autonomously decide a loan. Approval can create closing tasks and signature requests. Staff record funding only after closing gates pass; doing so creates a linked funded loan account exactly once.

Every demo labels provider results and funding as simulated. No first-release action transfers money.

## Amounts and products

Use USD initially and exact monetary values. Test $10,000, $5,000,000, and $7,500,000. These are coverage examples, not hard lending limits or a definition of business size. Product configuration supplies any minimum/maximum and requirements; never scatter thresholds through components.

Provide sample small-business and commercial requirement templates. Requirements can depend on product, amount, entity type, owners, and supplied information. Unknown information produces an explicit information task rather than a made-up fact. Persist the applied rules version. Template changes must not silently rewrite previously reviewed decisions.

## UI expectations

Use shadcn components generated by its CLI, Tailwind, and default shadcn styling. Prefer straightforward forms, cards, tables, tabs, badges, dialogs, alerts, and accessible status messages. Avoid custom branding exercises in the initial milestones.

Support keyboard navigation and mobile borrower layouts. Do not rely on color alone, a drag gesture alone, or toast messages alone. Preserve entered values on errors. Show useful empty, loading, denied, expired-link, failed-upload, and retry states. Poll for asynchronous changes initially; a WebSocket service is unnecessary.
