# Business lending workflow and product expansion

**October 13 scope:** All lending expansion tasks serve Keybank exclusively through KeyLend. Retain access isolation tests; do not build onboarding, theming or selection for other institutions.

Research: October 12, 2026. Documentation completed: October 13, 2026. KeyLend should model a financing request that can contain several loan facilities, with explicit underwriting, credit approval, offer acceptance, closing clearance and funding for the agreed structure. A facility is one separately documented credit product within that request.

The user's October 12 follow-up replaces the fixed Synthetic Business Credit selection and the assumption that one application always produces one loan account. Applicants should choose a loan type; lenders should be able to change amounts, switch products, and split or combine facilities after intake. The reference scenario is a $9 million request initially described as SBA financing, restructured into $5 million of SBA 7(a) and $4 million of conventional financing.

## Read in order

1. [How loans move through a bank](01-bank-workflows.md): small, medium and large examples, responsibilities, handoffs and primary sources.
2. [Products and restructuring](02-products-and-restructuring.md): 19 product types and variants, three initial product families, the financing model and revision rules.
3. [Gaps in the current application](03-gap-analysis.md): findings tied to the inspected implementation.
4. [Delivery and validation](04-delivery-and-validation.md): L01–L10, dependencies, acceptance criteria and demonstration scenarios.

## Implementation boundary

The research is a completed documentation deliverable. **L01 is done locally** (October 13, 2026): the database, contracts, domain commands and both HTTP transports represent an overall request, versioned multi-facility structures and legacy mappings, and structured applications cannot use the legacy approval or funding routes. It adds no screens. L02–L10 are **Not started**. Historical T01–T22 and V2 acceptance records remain valid for their original scope. The [R01 record](../tasks/R01-lending-workflow-research.md) describes the documentation change and its verification; the [L01 record](04-delivery-and-validation.md#l01-validation-record) owns implementation evidence.

Continue the lending implementation with **L02**. That delivers the requested product choice and editable financing structure before adding deeper underwriting. Do not build all catalog entries at once. The proposed first families are SBA 7(a) term lending, conventional business term lending, and equipment term lending. Other entries remain research/reference choices until their workflow exists.

All identities, financial evidence, eligibility results, program authorizations, signatures and funding remain synthetic in every environment. Product screens retain neutral wording under D07; simulation provenance remains in backend records and demo tooling. SBA submission, credit bureau, lien filing, email delivery and payment integrations remain simulated.

The expansion covers origination through initial funding of each facility. It does not authorize repayment schedules, balances, interest accrual, collection, ongoing revolving draws, construction draw administration, or modifications of already funded debt. Proposed rates, maturities and repayment assumptions are origination terms used for review, not a servicing engine.

## How to interpret the research

U.S. business lending is the working jurisdiction. Loan amount, borrower revenue, SBA business-size eligibility, and a bank's approval authority are different concepts. The size bands and staff roles proposed here are configurable demo policies, not legal thresholds or claims about a particular bank's internal procedures. Public KeyBank pages supply product examples only.

Sources were accessed on October 12, 2026. Effective dates matter: the SBA changed coordination of 7(a) and 504 limits in July 2026, and FinCEN changed repeat-account beneficial-owner collection requirements in February 2026. Keep source versions and review dates with policy fixtures. Never turn this research into an assertion that the demo provides complete regulatory compliance.
