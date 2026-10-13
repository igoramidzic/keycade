# How business loans move through a bank

Keycade covers the outer lending journey well, but its review stage currently combines several different bank functions. A more complete origination model separates repayment analysis, authority to approve a proposed structure, the customer's acceptance, legal and collateral clearance, and authority to release funds. These workstreams often overlap and return for more information.

This research covers U.S. business lending through initial funding. Subsequent account administration is identified only to define the handoff; it remains outside Keycade's release scope.

## What small medium and large mean

There is no single dollar classification that determines every bank's workflow. The OCC describes underwriting depth as dependent on loan type and size, and lending authority as dependent on amount, policy exceptions, borrower history and risk. Individual, joint and committee approval arrangements are all possible. Banks may automate some small-business underwriting; Keycade's decisions remain human. [OCC lending handbook, printed pages 24–28][occ-lending]

Use these **illustrative Keycade routing bands**, applied to the proposed package's aggregate commitment and considered alongside existing exposure. They do not set product eligibility or borrower size:

| Demo band | Amount illustration | Typical work to represent | Proposed demo treatment |
| --- | --- | --- | --- |
| Small | Up to $250,000; include the existing $10,000 fixture | Focused business and owner evidence, repayment capacity, credit history, standardized terms; manual escalation for exceptions | Short credit memo and delegated approver when policy allows |
| Medium | Above $250,000 through $2 million | Several financial periods, debt schedule, guarantor support where applicable, collateral analysis and negotiated conditions | Named analyst, independent credit reviewer and closing specialist |
| Large | Above $2 million; include $5 million, $7.5 million and $9 million | Deeper sensitivity analysis, related entities and aggregate exposure, approval escalation, counsel and possibly multiple facilities/lenders | Full credit package, configured senior approvals and separate funding release |

A small construction or acquisition request can require more work than a larger uncomplicated term loan. A $9 million package must not acquire small-loan authority merely by being split into many facilities. “Small business” eligibility under an SBA program is a separate test from these routing bands. The existing $100,000 use-of-funds task threshold is a historical demo policy, not an industry boundary.

## The bank workflow

The following is a synthesis for Keycade's workflow design. Roles are responsibilities; a smaller institution may assign several to one person, subject to its controls.

| Stage | Responsible function | Work and handoff artifact | Common return path |
| --- | --- | --- | --- |
| 1. Inquiry and initial fit | Relationship manager or loan officer | Understand purpose, total need, timing, product preference, entity and existing relationship; record an indicative structure | Revise the request or route to a different product |
| 2. Application and completeness | Applicant and loan processor | Obtain authority/consents, collect required fields and evidence, record receipt and completeness separately | Request specific missing items without losing the original receipt date |
| 3. Customer and entity diligence | Operations or compliance specialist | Identify the business and relevant people, distinguish ownership from signing authority, review applicable identity and sanctions results | Resolve discrepancies or hold the relevant stage |
| 4. Financial underwriting | Credit analyst or underwriter | Analyze historical and interim financials, existing debt, repayment sources and proposed obligations; prepare a credit memo | Ask for explanation, updated evidence, less debt or a different structure |
| 5. Product and collateral diligence | Product specialist, collateral reviewer and counsel | Assess eligible uses, guarantees, valuations, liens, insurance and program-specific requirements | Revise allocation, collateral, guarantees or conditions |
| 6. Credit decision | Delegated credit officer or approval group | Approve specific terms/conditions, counteroffer, decline or return for work; record authority and exceptions | Re-underwrite material changes; do not silently edit a decision |
| 7. Offer and acceptance | Loan officer and authorized borrower | Communicate the actual product mix, amounts, pricing, term, conditions and expiry; retain acceptance of that version | Negotiate a revised offer or record nonacceptance |
| 8. Documentation and closing clearance | Loan operations, legal and authorized signers | Match legal documents to approved terms; verify signatures, authority, collateral and conditions | Correct documents, renew expired evidence or obtain reapproval |
| 9. Funding authorization and release | Funding preparer and authorized releaser | Verify recipients, sources/uses, amounts and current clearance; record the release result and references | Hold or reconcile a failed/uncertain attempt before retry |
| 10. Booking and final file review | Loan operations | Verify the account reflects the approved loan, reconcile recorded funding and identify trailing documents | Assign unresolved closing-file items to an owner |

The table expands the product journey into implementation responsibilities; it is not a claim that every institution uses these exact ten steps. The OCC separately describes pre-closing, closing, booking and post-closing reviews and controls such as segregation of duties and reconciliation. Signing therefore should not itself mean that funding is authorized. [OCC lending handbook, printed pages 35–36][occ-lending]

An initial expression of interest or indicative term sheet is not final approval. Underwriting generally supports the credit decision; outstanding conditions may still need review after a conditional decision. Keycade should show which conditions affect the credit judgment and which simply complete documentation, rather than using “approved” to mean every step is finished.

## What underwriting adds beyond collecting documents

Bank of America's public guide describes financial evidence including tax returns, profit-and-loss statements, bank statements, a balance sheet and, where needed, projections and personal financial information. Its underwriting explanation includes verification of income, assets, debt and collateral. The precise evidence depends on lender and product; do not require every item for every application. [Bank of America application guide][boa-guide]

For most small-business loans, the OCC identifies business cash flow as the primary repayment source. Collateral and guarantees are additional support, not a substitute for demonstrating repayment capacity. [OCC small-business lending][occ-small]

Build a staff-authored analysis around the following proposed sections:

- **Business and request:** management, operating history, industry, ownership/control, sources and uses, existing relationship and the reason for borrowing.
- **Financial spreads:** comparable annual and interim periods; accounting basis and currency; reconciliation of tax, financial-statement and bank-statement differences. Deposits are not automatically revenue.
- **Debt and capacity:** existing obligations plus all proposed facilities; principal and interest assumptions, maturities, balloon/refinancing exposure and contingent obligations. Record whether a refinanced debt is replaced rather than counting both debts indefinitely.
- **Adjustments and sensitivities:** explain each adjustment to earnings/cash flow and test a downside case. Do not adopt extracted values or normalize income automatically.
- **Support and risks:** guarantor capacity when relevant, collateral values and prior liens, customer concentrations, key-person and industry risks, and how proposed conditions address them.
- **Recommendation:** structured terms, a staff-selected risk assessment, unresolved concerns, requested policy exceptions and a concise rationale.

For an illustrative debt-service coverage ratio (DSCR), divide the policy-defined cash available for debt service by the corresponding annual debt service. A synthetic $180,000 numerator and $150,000 denominator produce 1.20×. This is an arithmetic example, not a recommended approval threshold. Define the calculation's period, borrower perimeter, adjustments and treatment of proposed facilities. Unknown or zero denominators yield “not calculable,” not a passing result. No universal DSCR threshold or automatic approval is proposed.

## Product branches that change the process

| Branch | Extra work to model | Boundary |
| --- | --- | --- |
| Conventional term or equipment financing | Repayment capacity, asset/vendor evidence when secured, useful-life fit and guarantees where required | First implementation candidates; terms and required evidence are bank policies |
| SBA 7(a) | Program eligibility, eligible uses, existing SBA exposure, applicable guarantees, lender processing authority and a separate program authorization record | A government guaranty does not eliminate lender underwriting; use only fake program outcomes |
| SBA 504 | A project with a senior lender, a Certified Development Company and borrower contribution; fixed-asset eligibility and coordinated funding | Not a generic $5 million working-capital loan; detailed support deferred |
| Commercial real estate | Property cash flow, appraisal/evaluation, title/lien review, environmental assessment and applicable insurance/flood work | Scope and timing vary with collateral and product |
| Construction | Budget, borrower equity, completion/repayment plan, inspections, lien review and controlled advances | Full construction draw administration remains deferred |
| Revolving or asset-based credit | Commitment versus initial utilization; collateral eligibility and borrowing-base support where applicable | A limit is not a funded amount or an outstanding balance |
| Participated or syndicated credit | Separate institutional commitments, responsibilities and conditions | Larger loans are not automatically syndicated; multi-bank settlement is deferred |

SBA's lender resources distinguish processing methods and product-specific conditions. The 504 overview limits proceeds to qualifying fixed-asset purposes and excludes ordinary working capital/inventory. [SBA lender resources][sba-lenders] [SBA 504][sba-504]

The OCC's real-estate handbook describes environmental diligence and construction controls, including inspections, budget monitoring, lien searches and dual disbursement approval. These are reasons to route by transaction complexity rather than amount alone. [OCC CRE handbook, printed pages 45 and 66–68][occ-cre]

The Shared National Credit review covers large shared commitments of at least $100 million. That is a supervisory program threshold, not a minimum for loan participation or Keycade's definition of a large loan. [Federal Reserve 2025 SNC release][snc]

## Easily missed controls and unsuccessful outcomes

**Identity, ownership and authority are separate.** Customer identification, beneficial-owner diligence, sanctions screening, legal authority to borrow, personal guarantees and portal permissions should not collapse into one checkbox. FFIEC describes risk-based customer identification and treats OFAC checks as separate requirements. FinCEN's February 2026 relief permits covered institutions to avoid repeating beneficial-owner identification at every new account in specified circumstances; first-account, reliability concerns and risk-based refresh obligations remain. Reuse must therefore be an explicit, current, authorized assessment. [FFIEC CIP][cip] [FinCEN CDD FAQs, B.1][cdd]

**Receipt, completeness and a UI submission button are different events.** Regulation B has business-credit notification provisions that distinguish businesses by preceding-year gross revenue, including a $1 million boundary; that is not the requested loan amount. It also addresses incomplete applications, counteroffers and specific adverse-action reasons. A generic “criteria not met” reason and an inactivity reminder are not substitutes for a decision-notice process. Model dated events and versioned notice policy; do not encode “30 days for every loan from clicking Submit.” [CFPB Regulation B section 1002.9][reg-b]

**Unsuccessful paths need owners.** Model requests for information, declined credit, borrower withdrawal, offer expiry/nonacceptance, expired evidence, superseded approval, failed signing, unresolved closing conditions and failed/uncertain funding attempts. An internal SLA can pause while waiting on a borrower; a notification deadline must follow its own configured rule and must not silently reset.

**Collateral clearance is more than a signature.** Where applicable, track the intended security interest, valuation, prior liens/payoffs, required filings and evidence of completion. A filing requested or queued is not evidence that a lien is perfected. Some trailing documents arrive after closing; distinguish an expressly permitted trailing item from a mandatory pre-funding condition.

**Funding has its own controls.** The proposed Keycade flow records separate preparation and release, independently confirms synthetic recipient instructions, rechecks current conditions and reconciles amounts. Sending a request, timing out, and confirming funding are distinct outcomes. Each facility must have its own funding identity within the overall application.

## Timing and borrower communication

Do not promise a universal time to funding. Bank of America's examples range from about a week for some unsecured decisions to weeks or months for other products. That is one lender's guidance, not a service commitment; SBA's published processing times are also not an end-to-end bank funding promise. [Bank of America guide][boa-guide]

Show the borrower the current stage, requested action, responsible bank contact and dated status update. Show staff aging, who is waiting on whom, stale evidence, offer expiry and the next handoff. Demo processing delays remain configurable and tests use injected clocks.

## Primary source register

All links below were read on October 12, 2026. Dates describe the source, not a claim that all surrounding law was reviewed.

| Source | Version or relevant section | Use |
| --- | --- | --- |
| [OCC Lending and Loan Portfolio Risk Management][occ-lending] | June 2026, printed pages 24–28 and 35–36 | Underwriting, authority and administration |
| [OCC Small Business Lending][occ-small] | Current topic page | Repayment-source principle |
| [Bank of America business-loan guide][boa-guide] | August 8, 2025 | Borrower evidence and timing examples |
| [OCC Commercial Real Estate Lending][occ-cre] | March 2022, version 2.0; PDF notes March 2025 reputation-risk removal | Property, construction and collateral branches |
| [SBA lender resources][sba-lenders] | Current product descriptions; mutable page | SBA product variants and processing |
| [SBA 504 overview][sba-504] | Current overview | Fixed-asset uses and CDC participation |
| [CFPB Regulation B section 1002.9][reg-b] | Notifications and official interpretations | Completeness, counteroffers, reasons and business-credit distinctions |
| [FFIEC Customer Identification Program][cip] | February 2021 examination material | Identity versus other controls |
| [FinCEN CDD FAQs][cdd] | B.1 updated May 6, 2026; February 13 relief | Beneficial-owner collection/refresh |
| [Federal Reserve 2025 SNC release][snc] | January 12, 2026 | Large shared-credit context |

Product-specific references and the July 2026 SBA coordination notice are in [the product catalog](02-products-and-restructuring.md#sources-and-policy-maintenance). Implementation findings use [the repository evidence map](03-gap-analysis.md).

[occ-lending]: https://www.occ.treas.gov/publications-and-resources/publications/comptrollers-handbook/files/lending-loan-portfolio-risk-management/pub-ch-lending-loan-portfolio.pdf
[occ-small]: https://www.occ.treas.gov/topics/supervision-and-examination/credit/commercial-credit/small-business-lending.html
[boa-guide]: https://business.bankofamerica.com/en/resources/what-is-business-loan-and-how-do-i-get-one
[occ-cre]: https://www.occ.gov/publications-and-resources/publications/comptrollers-handbook/files/commercial-real-estate-lending/pub-ch-commercial-real-estate.pdf
[sba-lenders]: https://www.sba.gov/sba-lenders/
[sba-504]: https://www.sba.gov/loans/504-loans/
[reg-b]: https://www.consumerfinance.gov/rules-policy/regulations/1002/9/
[cip]: https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/01
[cdd]: https://www.fincen.gov/resources/statutes-and-regulations/cdd-rule-faqs
[snc]: https://www.federalreserve.gov/newsevents/pressreleases/bcreg20260112a.htm
