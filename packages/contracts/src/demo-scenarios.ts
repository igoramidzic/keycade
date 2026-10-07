import type { DocumentCategory } from "./document-processing.js";

/** Public, fictional demonstration material. This catalog never represents application access. */
export type DemoDocument = {
  id: string;
  title: string;
  fileName: string;
  category: DocumentCategory;
  subject: "business" | "guarantor";
  outcome:
    | "clear"
    | "name_mismatch"
    | "cash_flow"
    | "low_confidence"
    | "scan_blocked"
    | "processing_transient"
    | "processing_error"
    | "unknown";
  rows: { label: string; value: string }[];
  summary: string;
};
export type DemoScenario = {
  id: string;
  title: string;
  description: string;
  business: {
    name: string;
    ein: string;
    industryCode: string;
    requestedAmount: string;
    purpose: string;
  };
  client: { name: string; email: string };
  guarantors: { name: string; email: string; ownershipPercent: number; ssn: string }[];
  adviser: { name: string; email: string };
  steps: string[];
  documents: DemoDocument[];
};
const business = {
  name: "Synthetic Cedar Workshop",
  ein: "00-0000001",
  industryCode: "337110",
  requestedAmount: "10000.00",
  purpose: "Synthetic equipment purchase",
};
const people = {
  client: { name: "Alex Cedar (fictional)", email: "borrower@example.test" },
  guarantors: [
    {
      name: "Jordan Cedar (fictional)",
      email: "owner@example.test",
      ownershipPercent: 60,
      ssn: "000-00-0001",
    },
  ],
  adviser: { name: "Casey Pine (fictional)", email: "adviser@example.test" },
};
const taxRows = [
  { label: "Tax year", value: "2025" },
  { label: "Synthetic EIN", value: business.ein },
  { label: "Gross receipts", value: "125000.00" },
  { label: "Deductible expenses", value: "95000.00" },
  { label: "Net business income", value: "30000.00" },
];
const bankRows = [
  { label: "Statement period", value: "September 2026" },
  { label: "Institution", value: "Keycade Fictional Bank" },
  { label: "Demo account reference", value: "DEMO-CEDAR-001" },
  { label: "Opening balance", value: "22000.00" },
  { label: "Deposits", value: "18000.00" },
  { label: "Withdrawals", value: "15000.00" },
  { label: "Closing balance", value: "25000.00" },
];
const financialRows = [
  { label: "Reporting year", value: "2025" },
  { label: "Revenue", value: "125000.00" },
  { label: "Expenses", value: "95000.00" },
  { label: "Net income", value: "30000.00" },
  { label: "Cash assets", value: "25000.00" },
];

export const demoScenarios: DemoScenario[] = [
  {
    id: "clear",
    title: "Everything checks out",
    description:
      "Matching business records and healthy sample finances. Walk through collection, review, signing, and simulated funding.",
    business,
    ...people,
    steps: [
      "Start an application using the client email. Complete the saved setup questions with the business details below.",
      "Add the guarantor and invite the adviser from People. Assign only the tasks each person should handle.",
      "Upload the business PDFs into Documents or the relevant task. Use the private guarantor task for the guarantor PDF.",
      "Enter the synthetic EIN and guarantor SSN in their secure tasks, give demo tax authorization, and wait for simulated checks.",
      "Submit completed tasks for staff review. Sign in to the bank console as officer-a@example.test to accept evidence and review readiness.",
      "Submit the application, record a human approval, start closing, complete both intended signatures, and record simulated funding.",
      "Inspect the resulting loan account, Activity, Operations, and Demo inbox. Funding records a demonstration; no money moves.",
    ],
    documents: [
      {
        id: "clear-tax",
        title: "Business tax return",
        fileName: "cedar-2025-tax-return.pdf",
        category: "tax",
        subject: "business",
        outcome: "clear",
        rows: taxRows,
        summary:
          "The business name should match the application. Sample gross receipts are 125000.00 and net income is 30000.00.",
      },
      {
        id: "clear-bank",
        title: "September bank statement",
        fileName: "cedar-september-bank-statement.pdf",
        category: "bank_statement",
        subject: "business",
        outcome: "clear",
        rows: bankRows,
        summary:
          "The business name should match. Deposits exceed withdrawals and the sample closing balance is 25000.00.",
      },
      {
        id: "clear-ein",
        title: "Synthetic EIN letter",
        fileName: "cedar-synthetic-ein-letter.pdf",
        category: "business_legal",
        subject: "business",
        outcome: "clear",
        rows: [
          { label: "Synthetic EIN", value: business.ein },
          { label: "Entity type", value: "Fictional limited liability company" },
          { label: "Demo issuance date", value: "2026-01-15" },
        ],
        summary:
          "A fictional EIN assignment letter for the named business. This is not an IRS notice or a valid tax identifier.",
      },
      {
        id: "clear-financials",
        title: "Annual financial summary",
        fileName: "cedar-2025-financial-summary.pdf",
        category: "financial_statement",
        subject: "business",
        outcome: "clear",
        rows: financialRows,
        summary:
          "The sample financial summary has positive income. Suggested values remain unverified and require human review.",
      },
      {
        id: "clear-guarantor",
        title: "Guarantor identity summary",
        fileName: "jordan-cedar-synthetic-identity.pdf",
        category: "identification",
        subject: "guarantor",
        outcome: "clear",
        rows: [
          { label: "Fictional guarantor", value: people.guarantors[0].name },
          { label: "Synthetic SSN", value: people.guarantors[0].ssn },
          { label: "Ownership percentage", value: "60%" },
          { label: "Document purpose", value: "Private guarantor-task evidence only" },
        ],
        summary:
          "Use the intended guarantor's private task. Ownership alone never grants portal access. This is not identity verification.",
      },
    ],
  },
  {
    id: "review",
    title: "Needs a closer look",
    description:
      "A tax return for a different business, a cash-flow flag, and uncertain financial extraction.",
    business,
    ...people,
    steps: [
      "Upload the mismatched tax return. Inspect the extracted business name and the simulated name-mismatch finding.",
      "Upload the low-balance statement. Inspect withdrawals, deposits, closing balance, and the cash-flow review flag.",
      "Upload the unclear financial summary. Review its original PDF and low-confidence suggestions.",
      "Have staff request more information or return a task with a reason. Replace the tax return with the matching return from Everything checks out.",
      "Review both immutable versions and interpretation history, then submit the corrected evidence. Findings never approve or complete a task.",
    ],
    documents: [
      {
        id: "review-tax",
        title: "Tax return with a different name",
        fileName: "juniper-mismatched-tax-return.pdf",
        category: "tax",
        subject: "business",
        outcome: "name_mismatch",
        rows: taxRows,
        summary:
          "This return names a different fictional business instead of the application business. Ask for the correct business return.",
      },
      {
        id: "review-bank",
        title: "Bank statement with a cash-flow flag",
        fileName: "cedar-cash-flow-review.pdf",
        category: "bank_statement",
        subject: "business",
        outcome: "cash_flow",
        rows: [
          { label: "Statement period", value: "September 2026" },
          { label: "Institution", value: "Keycade Fictional Bank" },
          { label: "Demo account reference", value: "DEMO-CEDAR-002" },
          { label: "Opening balance", value: "25000.00" },
          { label: "Deposits", value: "8400.00" },
          { label: "Withdrawals", value: "32200.00" },
          { label: "Closing balance", value: "1200.00" },
        ],
        summary:
          "Withdrawals exceed deposits by 23800.00, leaving a sample closing balance of 1200.00. Flag for human review; this is not a credit determination.",
      },
      {
        id: "review-financials",
        title: "Financial summary needing review",
        fileName: "cedar-uncertain-financial-summary.pdf",
        category: "financial_statement",
        subject: "business",
        outcome: "low_confidence",
        rows: financialRows,
        summary:
          "This fixture deliberately produces low-confidence extraction. A reviewer must check the original amounts.",
      },
    ],
  },
  {
    id: "recovery",
    title: "Failures and recovery",
    description:
      "Demonstrate automatic retries, a persistent interpretation error, quarantined evidence, and an unknown document.",
    business,
    ...people,
    steps: [
      "Upload the retrying statement. Its first interpretation attempt fails temporarily; the worker retries after the configured delay.",
      "Upload the unreadable tax return. The scan succeeds, interpretation fails, and the original remains downloadable. Retry to inspect another run.",
      "Upload the quarantine example. The simulated scan blocks downloads and interpretation. No actual malware is present.",
      "Upload the unknown memo. It remains available in Other for review. Staff can correct its category with an audited reason.",
      "Use Operations to inspect safe error codes and retry actions, and Activity to inspect the history. Replace failing evidence with a clear sample to continue.",
    ],
    documents: [
      {
        id: "recovery-bank",
        title: "Statement that retries automatically",
        fileName: "cedar-retrying-bank-statement.pdf",
        category: "bank_statement",
        subject: "business",
        outcome: "processing_transient",
        rows: bankRows,
        summary:
          "The first simulated interpretation attempt fails transiently. A later automatic attempt succeeds without creating another document.",
      },
      {
        id: "recovery-tax",
        title: "Return with interpretation failure",
        fileName: "cedar-interpretation-error.pdf",
        category: "tax",
        subject: "business",
        outcome: "processing_error",
        rows: taxRows,
        summary:
          "This fixture deliberately fails simulated interpretation. Clean original bytes remain available for download and human review.",
      },
      {
        id: "recovery-blocked",
        title: "Simulated quarantine example",
        fileName: "cedar-simulated-quarantine.pdf",
        category: "other",
        subject: "business",
        outcome: "scan_blocked",
        rows: [
          { label: "Fixture behavior", value: "Blocked by the simulated scan" },
          { label: "Actual contents", value: "Harmless fictional text; no malware" },
        ],
        summary:
          "A harmless registered fixture demonstrates quarantine. The backend denies downloads and does not interpret blocked content.",
      },
      {
        id: "recovery-unknown",
        title: "Uncategorized business memo",
        fileName: "cedar-unknown-memo.pdf",
        category: "other",
        subject: "business",
        outcome: "unknown",
        rows: [
          { label: "Memo", value: "Fictional workshop planning notes" },
          { label: "Requested action", value: "Human review of the original document" },
        ],
        summary:
          "This registered fixture has no supported document classification. It stays in Other until reviewed or manually categorized.",
      },
    ],
  },
];
export const demoDocuments = demoScenarios.flatMap((scenario) => scenario.documents);

export function demoDocumentBusinessName(document: DemoDocument, businessName = business.name) {
  // Quarantine content must retain its hash even if a draft's business name changes before scanning.
  if (document.outcome === "scan_blocked") return business.name;
  if (document.outcome === "name_mismatch")
    return businessName.trim().toLowerCase().replace(/\s+/g, " ") === "synthetic juniper services"
      ? "Synthetic Willow Services"
      : "Synthetic Juniper Services";
  return businessName;
}
function pdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/([\\()])/g, "\\$1");
}
function wrap(value: string, length: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    if (line.length + word.length + 1 > length && line) {
      lines.push(line);
      line = "";
    }
    // Bound long unbroken values so arbitrary application names remain inside the page.
    for (let start = 0; start < word.length; start += length) {
      const part = word.slice(start, start + length);
      if (start > 0) {
        lines.push(line);
        line = "";
      }
      line = line ? `${line} ${part}` : part;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A complete deterministic, text-readable PDF; browser and server generate identical bytes. */
export function createDemoDocumentPdf(
  document: DemoDocument,
  businessName = business.name,
): Uint8Array {
  const commands: string[] = [];
  function text(
    value: string,
    x: number,
    y: number,
    size = 11,
    bold = false,
    color = "0.16 0.18 0.24",
  ) {
    commands.push(
      `BT ${color} rg /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfText(value)}) Tj ET`,
    );
  }
  commands.push("0.93 0.94 0.98 rg 0 692 612 100 re f");
  text("KEYCADE / SYNTHETIC DEMO", 44, 753, 12, true, "0.28 0.28 0.55");
  text(document.title, 44, 718, 19, true);
  let y = 659;
  for (const line of wrap(demoDocumentBusinessName(document, businessName), 65)) {
    text(line, 44, y, 13, true);
    y -= 19;
  }
  text("FICTIONAL RECORD - NOT VALID FINANCIAL, TAX, OR IDENTITY EVIDENCE", 44, y - 7, 8, true);
  y -= 42;
  for (const row of document.rows) {
    text(row.label.toUpperCase(), 44, y, 9, true, "0.42 0.44 0.49");
    y -= 18;
    for (const line of wrap(row.value, 78)) {
      text(line, 44, y, 12);
      y -= 17;
    }
    y -= 14;
  }
  y -= 6;
  text("DEMONSTRATION NOTES", 44, y, 10, true);
  y -= 19;
  for (const line of wrap(document.summary, 88)) {
    text(line, 44, y, 10);
    y -= 15;
  }
  commands.push("0.83 0.84 0.88 RG 44 66 m 568 66 l S");
  text(
    "All names, identifiers, accounts, and amounts are fictional. No external provider is called.",
    44,
    48,
    8,
  );
  text(`Keycade sample: ${document.id} / page 1 of 1`, 44, 33, 8);
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
