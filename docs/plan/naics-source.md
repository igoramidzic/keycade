# Industry catalog source and maintenance

Evaluated October 7, 2026 for the T15 industry-search slice.

The application uses all **1,012 six-digit U.S. industries in NAICS 2022**, downloaded directly from the [U.S. Census Bureau code/title workbook](https://www.census.gov/naics/2022NAICS/6-digit_2022_Codes.xlsx). It deliberately selects national industries rather than mixing aggregate sectors into the same picker. Catalog entries are real classification reference data; all applicant records remain synthetic. A selection expresses the applicant's choice and does not verify the business or establish lending eligibility.

| Candidate | Coverage/version | Licensing and availability | Update policy and decision |
| --- | --- | --- | --- |
| Census Bureau downloadable code/title workbook | Complete 1,012 U.S. six-digit industries, 2022; code and title columns | Public official download without a key; downloaded successfully. U.S. government classification reference material is treated as public-domain U.S. government work under [17 USC 105](https://www.copyright.gov/title17/92chap1.html#105). Retain provenance; no third-party descriptions, images, or commercial enrichment data are included. | Chosen. Ship a checked-in snapshot. The [Census NAICS site](https://www.census.gov/naics/) provides versioned reference files and the 2027 revision notices; do not update on startup or silently reclassify saved applications. |
| [NAICS Association search/drilldown service](https://api.naics.com/) and its [product documentation](https://www.naics.com/naics-code-lookup-and-keyword-search/) | Advertises code, title, description/fuzzy search and hierarchy lookup; 2022 supported. Exact completeness was not independently validated. | Hosted API requires an organization/API key. Commercial terms, redistribution permission, quota, cost and SLA were not established in this evaluation; no account or paid service was provisioned. Public documentation was accessible through search; direct product-page fetch intermittently presented a challenge. | Product documentation says it plans to add revisions while retaining 2022 lookup. Optional future adapter only; not selected because a reproducible local index meets the demo's needs without runtime availability or credential dependencies. |

The repository search adds its own small everyday-language synonym table and tolerant word matching on top of the official titles. These hints are maintained separately in `industry-search.ts`; they are suggestions, not official Census definitions. Every result is an existing pinned catalog entry. Queries never create or automatically select a code, and numeric no-match searches do not use fuzzy numeric substitution.

## Reproduction and update procedure

1. Download the exact workbook URL above. The downloaded bytes on October 7 have SHA-256 `3e3c90d4d36d874c0fd2da22a222c794654dbfa404320304152f5317781aefb7`.
2. Read sheet 1, columns A/B. Keep rows where trimmed column A is exactly six digits; trim only leading/trailing whitespace from the title. Ignore the header and empty rows. Preserve workbook order. The resulting code/title pairs have 1,012 unique codes.
3. `packages/contracts/src/naics-2022.ts` stores those pairs. SHA-256 of their compact UTF-8 JSON serialization is `823bebe0e0ec637f261a737bd389528fc56f0514e453daa6a9f148712bf86466`, pinned by a test. No broad descriptions or proprietary keyword lists were copied.
4. Review Census revisions explicitly. Add a separately named catalog and taxonomy version for a future release, decide how old versions remain readable, update supported-input rules and tests, and record the decision. Do not reinterpret an existing code under another version. Corrections to the same official snapshot require reviewing the diff and replacing its recorded hashes intentionally.

## Search behavior

The browser lazily loads the local ranking module and searches the checked-in index. No search query leaves the browser and no provider key is present. The searchable popup uses shadcn's default Base UI components installed with `npx shadcn@latest add combobox --cwd packages/ui --yes`; existing button/input components were preserved. The popup handles lazy-load/search errors, retry, no match and request cancellation while retaining the user's query and explicit selection. Local search does not add a synthetic network delay; browser tests inject controlled delayed and failed responses to verify these states without a live external dependency.

New answers must provide a valid six-digit code and the explicit taxonomy version `2022`, or paired nulls for skip. Already saved historical answers remain readable and are not silently migrated. Editing a temporary broad industry from the old demo fixture requires selecting a precise industry or choosing Skip.
