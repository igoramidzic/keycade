# Version 2 experience requirements

Status: V2-01 setup, V2-02 borrower dashboard and V2-03 demo text importer are implemented and verified locally; V2-04 document review and financial facts are also implemented and verified locally; V2-05 lender overview and evidence drilldowns are also implemented and verified locally; V2-06 Loan Footprint is implemented and verified locally; V2-07 integrated local acceptance is complete; V2-08 hosted parity is complete with its separate actual-URL acceptance record. [Screenshot findings](01-screenshot-findings.md) identify the evidence and exclusions; [data contracts](03-data-and-simulation.md) define persistence and authority. Task IDs refer to [delivery](04-delivery-and-validation.md).

## Setup wizard — V2-01

Retain email-first entry, automatic Synthetic Business Credit assignment, server-saved progress, one logical question per screen, Back/Continue, optional Skip, Continue later, summary and explicit Finish setup. A structured address is one question with several address inputs. Do not copy the reference's combined business form into a single crowded screen.

New setup sequence after email/access:

| Screen | Required? | Behavior |
| --- | --- | --- |
| Legal business name | Yes | Rename the existing business-name prompt; preserve staff prefills and require applicant confirmation. Do not add a second competing name field. |
| Business address | Yes | Street, optional second line, city, state/region, postal code and explicit country. Validate the address structure; a country other than US can be saved and is reported by Loan Footprint. No live autocomplete/geocoder is needed. |
| Business taxpayer identification number (EIN) | No | Explicit Skip; accept only the demo's supported synthetic business identifiers through the encrypted identifier command. After save/resume show only presence and mask. Never collect SSN here. |
| Industry | No | Keep the existing searchable NAICS combobox, plain-language search and “I don't know.” Persist the selected code, label and taxonomy version. No invented “NAICS score.” |
| Website | No | Accept a valid HTTP/HTTPS URL or Skip. Show the selected NAICS code/industry underneath, or “Industry not provided”; an Edit industry link returns to the dedicated industry question. Do not fetch the website or infer facts from it. |
| Requested amount | Yes | Keep exact USD validation and configured limits. No product picker. |
| What are you seeking the funds for? | Yes | Select one or more illustrated options; show selected state with checkbox/checkmark and text. Save a collection of stable IDs, not one joined text field. |
| Review | Confirmation | Show all non-sensitive answers, selected purposes and only masked TIN/presence. Edit links return to saved steps. Finish setup remains atomic and idempotent. |

Purpose choices follow 4773: Working Capital, Equipment Purchase, Real Estate Purchase, Business Acquisition, Property Improvements, Refinance Debt, Refinance Real Estate, Other, Renewable Energy, Construction and Conventional. Use a small illustration or meaningful icon plus the text label in each card, with two columns on desktop and a single column on narrow screens. Use actual checkbox semantics, keyboard selection and a clear selected state that does not rely on color. Decorative artwork needs no redundant screen-reader description.

“Other” allows an optional detail question on the next screen, preserving one question per screen; it is not a return to mandatory free-text purpose. “Conventional” is retained as a reference choice label only; it cannot select a different product or change underwriting requirements by itself. The catalog and any future requirement mappings are versioned configuration.

The wizard can be completed without TIN, website, known NAICS, documents or checks. Missing required address or empty purposes prevents new-v2 completion. Skipping TIN does not assert tax verification or remove a legitimate later private requirement. A previously saved optional value has separate explicit Replace/Clear actions; skipping a question never silently erases it.

Legacy drafts retain every saved answer and move to the first newly required unanswered step. Existing free-text purpose appears on review as a previous response until the borrower selects v2 choices; do not guess a category. Completed legacy setups remain complete, with optional later correction flows instead of forcing re-onboarding. Staff-started applications retain email-only creation and optional prefills; expanded prefills cannot finish setup for the borrower.

## Borrower application dashboard — V2-02

Remove the application-level Overview/Tasks/Documents/Signatures/Review/Closing/People/Activity tab row. A completed application opens one dashboard. Keep application/business selection and funded-account summaries outside that removed navigation.

Desktop structure:

| Main column | Right sidebar |
| --- | --- |
| “Your tasks”: permitted personal/assigned tasks | Current application: business, permitted amount, all selected purposes, current stage |
| “Tasks for [business]”: permitted business tasks | Expandable progress timeline |
| Compact expandable rows in a fixed stage order; completed evidence still inspectable | Actual “Upload other documents” drop area and accessible file picker |
| Contextual submit, signature, additional-information and closing actions | Synthetic loan officer contact when available; safe empty state when unassigned |

Task rows carry understandable state labels: Needs your action, Submitted / Waiting for lender review, Changes requested, Completed, Waived. Show assignee/subject only where permitted. Completed rows remain expandable; cancelled/history items do not inflate outstanding counts. Do not send restricted collaborators hidden business/personal groups, names, terms or counts and merely hide them in CSS.

Rows stay in submission → approval → closing order, then creation order; a state change never moves a row. An expanded answer task shows its question as the field label, then Save/Submit; the reason, requirement source, assignee, fictional-data reminder and answer/review history sit in one collapsed “Details and history” section at the bottom. A “Changes requested” note appears above the field only while the task is returned.

Expanding a task uses the existing preloaded authorized details with no extra loading flash. Preserve unsaved edits, evidence uploads, signatures and validation. Shared business tasks have no in-task uploader; business files go through the sidebar, and the full Documents page can still attach a file to a specific task. Personal evidence upload stays in the corresponding private task, and assigned-only tasks or collaborators without general upload keep their task uploader; the general sidebar uploader must not broaden access. General uploads select the current application and use current document grants; they do not automatically satisfy a requirement. Render progress, scanning, processing, failure and retry in that sidebar flow.

Existing routes used by reminders and signing remain valid contextual destinations, or redirect to the dashboard with the right task/action open after authorization. Put participant/owner details and activity in contextual drawers or links where useful, with no replacement tab bar. Keep borrower invitations absent. Submission and closing actions remain visible at the appropriate stage; removing their tabs must not make them unreachable.

On mobile, show a compact application/stage summary above tasks, with expandable progress and an accessible upload section below. Task order and actions remain the same. The D05 demo kit reserves its own space on wide screens, collapses at intermediate widths and uses its existing dialog on mobile; it must not overlap or replace the application sidebar. Demo controls and actual application uploads must remain visually distinguishable.

### Timeline mapping

Derive stage and text from persisted setup/lifecycle/events. Never store a second mutable stage in the browser or present percentages as likelihood of approval.

| Keycade state/evidence | Borrower label and behavior |
| --- | --- |
| Setup in progress / `draft` | Initial Application Form; applicant remains in wizard, selector can show its saved progress |
| Setup completed; `collecting_information` | Initial Application Form complete; Application In Progress current |
| `submitted` | Application In Progress received; Underwriting “Awaiting lender review” |
| `in_review` | Underwriting current |
| `needs_information` | Application In Progress needs your action; retain prior review events, do not erase history |
| `approved` | Credit Decision approved; Closing next |
| `closing` | Closing current; signatures/conditions show their own state |
| `funded` plus linked account | Funding complete; Loan Booked as the recorded account milestone, with simulation label |
| `declined` / `withdrawn` | Explicit terminal outcome; later stages are not completed or silently green |

Loan Booked is a display milestone of existing atomic funding/account creation, not a new lifecycle transition. An expanded timeline can show completed/current/upcoming states using text and icons. Counts and blockers are scoped to the actor and stage. Do not disclose private check findings to explain an inaccessible blocker.

## Lender queue and application overview — V2-05

Keep the bank-scoped multi-application queue, search, filters, pagination, assignee and next-action information. Clicking an application opens Overview; retain lender tabs and the existing Participants, Tasks, Documents, Checks, Review, Closing, Activity, Operations, Signatures and Internal notes capabilities. Do not mirror lender navigation into the borrower app or replace working destinations with empty competitor labels.

Overview has three levels:

1. Business profile: legal name, NAICS label/code, structured address, optional website, and optional known years in business/employee count. Unknown facts say Not provided. Those optional facts can come from registered synthetic profile data or reviewed information; they are not additional required setup questions. A generic building illustration is enough; no street-image provider is required.
2. Financial overview: fiscal-period-labelled revenue/sales and adjusted net income, optional configured simulated DSCR, provenance/review status and previous-period comparison only where data supports it. Selecting a card expands a period history chart plus a readable values table. Source links open the appropriate document/version or manual-review record. Never render absent values as zero or silently mix periods/entities. Do not invent adjusted income from a tax return's ordinary income.
3. Loan/application: requested amount, all purposes, status, created date, assigned staff and optional target closing date if actually stored. Below, expandable lifecycle stages contain actual tasks, checks and evidence items, including completed work. Status changes invoke existing guarded commands, never a free-form stage dropdown.

Use visually distinct item types: Action required (a task), Check result (a simulated check), and Evidence (an uploaded/reviewed document or completed answer). These are projections over current records, not another workflow engine. A completed business tax return remains useful evidence even though no borrower action is outstanding.

Document groups show actual visible document counts and a separate review summary when relevant. Example: “Business tax returns · 3 documents” expands to three fiscal-year items; “2 reviewed, 1 waiting for review” describes their state. Missing configured periods appear as missing requirements, not fake uploaded documents. Replacement versions count as history of the same document; uploading the same period twice does not satisfy two separate years. Empty and partially complete groups work as well as a three-document fixture.

Clicking an individual item opens the document workspace. Close returns to the same expanded group and focus. Loan Footprint opens its map/modal. Existing personal evidence remains subject-restricted even when displayed among business-stage items.

## Document workspace — V2-04

Implementation status: **Done — local acceptance, October 8, 2026**. Lender Documents opens the workspace with a selected immutable version, Analysis, Document Info and Versions views. The shared private preview uses bundled PDF.js with selectable text, page navigation and zoom; the actual preview has been visually inspected and desktop/mobile acceptance passed. Authorized original-file downloads and existing scan/processing recovery remain available. V2-05 now supplies grouped Overview evidence and financial-history source entry points.

The implemented review action supports supplied monetary candidates from the registered tax and statement fixtures. Staff select Accept, Reject or Correct, inspect the current and proposed values, provide a reason and explicitly confirm a changed accepted amount. Corrections replace the exact decimal value only; the field's metric, actual period, basis and USD/money unit remain tied to the source. An incorrect period requires corrected document information or matching evidence, not moving a suggestion into another year. Missing or mismatched business identity prevents adoption.

Current facts use the latest accepted/corrected revision for that application's business metric and exact period/basis/unit. Rejection retains any previous accepted value and adds history. Replacement files, newer runs, category changes, analysis-relevant metadata changes or changed application business identity mark the previous source stale. The accepted amount remains visible until a lender deliberately reviews a current candidate. Display-name/description-only edits retain the analysis revision. Task-evidence acceptance and credit decisions remain separate actions; no new readiness gate is introduced because existing requirements/checks do not consume these financial facts.

Open an accessible large dialog from lender evidence or Documents. Desktop pairs the file preview on the left with details on the right. Preserve title, document/version identity, status and close control. Mobile stacks the two regions or uses accessible region switching; all information/actions remain reachable without horizontal overflow.

Preview supports current supported PDFs/images, page navigation where relevant, zoom, fit, and authorized download. Preview uses the same private, current-access-checked bytes as download. A quarantined file shows its metadata and safe state, not its bytes. A preview failure offers an authorized download/retry path for clean content. Switching versions changes both preview and displayed run/metadata; do not show current analysis beside an older file without a clear historical label.

Right-hand sections:

- Document Info: display name/original filename, description, type/category, analysis recipe/type, associated business and permitted client/subject, application, expected period, actual extracted period when known, uploader/time, current version and processing status. Written-response policy is read from the linked requirement. Editing supported metadata is staff-authorized and revision-checked; association cannot move files between applications or reveal a hidden participant.
- Analysis: Simulated label, execution time/state, concise mock summary, document overview, typed findings and suggested review steps. Expand Extracted Data for field name/value, units/currency/period, source page/field and whether pending, accepted or rejected. Clicking a source reference navigates to the relevant page; accurate bounding-box highlighting is optional, never fabricated.
- Versions: immutable uploaded versions and interpretation history, including replaced/stale/failed runs. The existing current-version and retry rules remain authoritative.

“Run simulated analysis” or Retry schedules durable work for the selected eligible version. Busy/queued states survive closing/reopening the dialog. Mock prose is rendered as inert content. Do not add new Comments/Fraud subproducts or live signature controls just because those tabs/buttons appear in the image; existing simulated signing remains reachable through its current workflow.

### Applying extracted values

Extraction is useful only if it connects to the record. A lender selects suggested fields, sees current versus proposed values with fiscal period and source, and explicitly chooses Apply selected values. The server accepts the entire reviewed selection atomically with an expected record revision. The UI shows which values were applied or a recoverable conflict; no silent partial overwrite.

Accept, reject and authorized correction preserve the original extracted suggestion and actor/reason/source history. A candidate that conflicts with an accepted value requires deliberate replacement and a reason. For this phase, editable draft/collecting/needs-information application facts may change; submitted/in-review/approved/closing/funded snapshots remain locked. Staff must use the existing return-for-information path before revising decision inputs. Viewing or re-running analysis never completes a task, approves a loan or updates shared business/client records automatically.

## Demo kit text input — V2-03

Add an explicit “Create demo document from text file” drop zone and keyboard/touch file picker inside the existing demo panel. Dropping a known `.txt` filename chooses its registered recipe. Show the recognized document type, period and expected mock values, then provide a generated, visibly synthetic PDF with Download, Drag to an authorized upload area, and Upload actions. If no permitted target is available, explain why and retain the sample card.

The result follows the existing application upload → scan → delayed interpretation path. Filename recognition in the panel is immediate; interpretation remains visibly asynchronous. The example journey is three tax-year files, one bank statement, lender group expansion, preview/analysis, reviewed adoption, and refreshed financial cards. Unknown names show supported recipe names and create no invented positive result. A normal application file drop does not reinterpret arbitrary text as a tax return.

## Loan Footprint — V2-06

The lender item opens a Geographic Eligibility dialog with the saved business address, a synthetic map/pin, country rule, current result and evaluated time/revision. Valid US country/address is green with “Within the demo's US footprint.” Non-US is “Outside the demo's US footprint,” without claiming a legal or credit determination. Missing/invalid address is Needs address; queued/running/error/stale results are not green.

Do not copy the reference's unrestricted global policy. No state, county, lending-radius or industry restrictions are introduced. All normal demonstration fixtures are US-based; non-US still has a negative automated test. The map is backed by registered fixture coordinates; unknown coordinates show an address and “Map location unavailable” instead of inventing a precise pin. Map rendering failure does not change the country result. A changed address invalidates the old check and marker before scheduling a replacement. No real geocoding, street imagery or external map service is required.
