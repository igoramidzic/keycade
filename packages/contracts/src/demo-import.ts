import { z } from "zod";
import type { ExtractedDocumentField } from "./document-processing.js";

export const demoImportMaxBytes = 64 * 1024;
export const demoImportMaxFiles = 10;
export const demoImportRecipeIds = [
  "business-tax-return-2023",
  "business-tax-return-2024",
  "business-tax-return-2025",
  "business-bank-statement-2026-01",
  "business-tax-return-review",
] as const;
export const demoImportContextSchema = z.strictObject({
  businessName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "A printable business name is required."),
  applicationRevision: z.number().int().nonnegative(),
});
export const demoTextImportRequestSchema = z.strictObject({
  fileName: z.string().min(1).max(160),
  text: z
    .string()
    .max(demoImportMaxBytes)
    .refine(
      (value) =>
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),
      "Text must contain well-formed Unicode.",
    ),
  context: demoImportContextSchema,
});
export const demoImportFixtureSchema = demoImportContextSchema.extend({
  recipeId: z.enum(demoImportRecipeIds),
  recipeVersion: z.literal(1),
});
export type DemoImportContext = z.infer<typeof demoImportContextSchema>;
export type DemoImportFixture = z.infer<typeof demoImportFixtureSchema>;
export type DemoImportRecipeId = (typeof demoImportRecipeIds)[number];
export type DemoImportPeriod = { start: string; end: string; basis: "fiscal_year" | "statement" };
export type DemoImportRecipe = {
  id: DemoImportRecipeId;
  version: 1;
  basename: string;
  fileName: string;
  title: string;
  category: "tax" | "bank_statement";
  period: DemoImportPeriod;
  outcome: "clear" | "needs_review";
  summary: string;
};
const taxRecipe = (year: number): DemoImportRecipe => ({
  id: `business-tax-return-${year}` as DemoImportRecipeId,
  version: 1,
  basename: `business-tax-return-${year}.txt`,
  fileName: `business-tax-return-${year}.pdf`,
  title: `${year} synthetic business tax return`,
  category: "tax",
  period: { start: `${year}-01-01`, end: `${year}-12-31`, basis: "fiscal_year" },
  outcome: "clear",
  summary:
    "Matching synthetic business tax return with revenue, ordinary income and a separate adjusted-income supporting schedule. All suggestions require lender review.",
});
export const demoImportRecipes: readonly DemoImportRecipe[] = [
  taxRecipe(2023),
  taxRecipe(2024),
  taxRecipe(2025),
  {
    id: "business-bank-statement-2026-01",
    version: 1,
    basename: "business-bank-statement-2026-01.txt",
    fileName: "business-bank-statement-2026-01.pdf",
    title: "January 2026 synthetic bank statement",
    category: "bank_statement",
    period: { start: "2026-01-01", end: "2026-01-31", basis: "statement" },
    outcome: "clear",
    summary:
      "Opening USD 80000.00 + deposits 125000.00 - withdrawals 110000.00 = closing 95000.00. Deposits are not revenue; this is a fictional statement, not a bank connection.",
  },
  {
    ...taxRecipe(2025),
    id: "business-tax-return-review",
    basename: "business-tax-return-review.txt",
    fileName: "business-tax-return-review.pdf",
    title: "2025 synthetic tax return needing review",
    outcome: "needs_review",
    summary:
      "This return names a different fictional business. Adjusted net income and adjustments were not supplied and remain unknown. Request corrected evidence; no automatic matching or financial confirmation occurs.",
  },
];
export class DemoImportValidationError extends Error {
  constructor(
    public readonly code:
      | "invalid_name"
      | "unknown_recipe"
      | "invalid_utf8"
      | "invalid_text"
      | "too_large"
      | "too_many_files"
      | "empty_batch",
    message: string,
  ) {
    super(message);
    this.name = "DemoImportValidationError";
  }
}
export function normalizeDemoImportBasename(fileName: string): string {
  // NFC preserves spelling. Compatibility characters and path separators never become aliases.
  const normalized = fileName.normalize("NFC").toLowerCase();
  if (
    normalized.length > 160 ||
    /[\\/\p{Cc}\p{Cf}]/u.test(normalized) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*\.txt$/.test(normalized)
  ) {
    throw new DemoImportValidationError(
      "invalid_name",
      "Choose a supported .txt basename without folders or extra extensions.",
    );
  }
  return normalized;
}
export type DemoTextImport = { fileName: string; bytes: Uint8Array };
export function validateDemoTextImport(input: DemoTextImport): DemoImportRecipe {
  const basename = normalizeDemoImportBasename(input.fileName);
  if (input.bytes.byteLength > demoImportMaxBytes)
    throw new DemoImportValidationError(
      "too_large",
      "Each demo text file must be no larger than 64 KiB.",
    );
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(input.bytes);
  } catch {
    throw new DemoImportValidationError("invalid_utf8", "Choose a valid UTF-8 text file.");
  }
  // Tab and line endings are the only controls permitted. Text is never executed or interpreted.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}]/u.test(text))
    throw new DemoImportValidationError(
      "invalid_text",
      "Choose plain text without binary data or hidden control characters.",
    );
  const recipe = demoImportRecipes.find((entry) => entry.basename === basename);
  if (!recipe)
    throw new DemoImportValidationError(
      "unknown_recipe",
      `Unknown demo filename. Supported files: ${demoImportRecipes.map((entry) => entry.basename).join(", ")}.`,
    );
  return recipe;
}
export function validateDemoTextImportBatch(files: readonly DemoTextImport[]): DemoImportRecipe[] {
  if (files.length === 0)
    throw new DemoImportValidationError(
      "empty_batch",
      "Choose at least one supported demo text file.",
    );
  if (files.length > demoImportMaxFiles)
    throw new DemoImportValidationError(
      "too_many_files",
      "Import up to 10 demo text files at a time.",
    );
  return files.map(validateDemoTextImport);
}
export function demoImportFixtureFor(
  recipeId: string,
  context: DemoImportContext,
): DemoImportFixture {
  return demoImportFixtureSchema.parse({ ...context, recipeId, recipeVersion: 1 });
}
export function demoImportRecipe(recipeId: string): DemoImportRecipe {
  const recipe = demoImportRecipes.find((entry) => entry.id === recipeId);
  if (!recipe)
    throw new DemoImportValidationError("unknown_recipe", "Choose a registered demo recipe.");
  return recipe;
}
export function demoImportBusinessName(fixture: DemoImportFixture): string {
  if (fixture.recipeId !== "business-tax-return-review") return fixture.businessName;
  return fixture.businessName.trim().toLowerCase().replace(/\s+/g, " ") ===
    "synthetic juniper services"
    ? "Synthetic Willow Services"
    : "Synthetic Juniper Services";
}
/** The values below are the only authority for both printed facts and simulated suggestions. */
export function demoImportFields(fixture: DemoImportFixture): ExtractedDocumentField[] {
  const recipe = demoImportRecipe(fixture.recipeId);
  const field = (
    key: string,
    label: string,
    value: string,
    kind: "money" | "year" | "text",
    page = 1,
  ): ExtractedDocumentField => ({
    key,
    label: `Suggested synthetic ${label}`,
    value,
    kind,
    provenance: {
      recipeId: recipe.id,
      recipeVersion: 1,
      sourcePage: page,
      sourceLabel: label,
      period: recipe.period,
      currency: kind === "money" ? "USD" : null,
      subject: "business",
      supplied: true,
    },
  });
  const name = field(
    "business_name",
    "Business legal name",
    demoImportBusinessName(fixture),
    "text",
  );
  if (recipe.category === "bank_statement")
    return [
      name,
      field("statement_start", "Statement start", recipe.period.start, "text"),
      field("statement_end", "Statement end", recipe.period.end, "text"),
      field("account_display_suffix", "Fictional account suffix", "DEMO-0042", "text"),
      field("opening_balance", "Opening balance", "80000.00", "money"),
      field("deposits", "Deposits", "125000.00", "money"),
      field("withdrawals", "Withdrawals", "110000.00", "money"),
      field("closing_balance", "Closing balance", "95000.00", "money"),
    ];
  const year = recipe.period.start.slice(0, 4);
  const amounts = {
    "2023": [
      "1220000.00",
      "20000.00",
      "1200000.00",
      "160000.00",
      "12000.00",
      "8000.00",
      "180000.00",
    ],
    "2024": [
      "1375000.00",
      "25000.00",
      "1350000.00",
      "185000.00",
      "15000.00",
      "10000.00",
      "210000.00",
    ],
    "2025": [
      "1530000.00",
      "30000.00",
      "1500000.00",
      "215000.00",
      "15000.00",
      "10000.00",
      "240000.00",
    ],
  }[year];
  if (!amounts) throw new Error("Unsupported registered tax period.");
  const [gross, returns, revenue, income, depreciation, oneTime, adjusted] = amounts as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  return [
    name,
    field("tax_year", "Tax year", year, "year"),
    field("form_type", "Form type", "Synthetic business return (not an IRS form)", "text"),
    field("gross_sales", "Gross sales / receipts", gross, "money"),
    field("returns_allowances", "Returns / allowances", returns, "money"),
    field("revenue", "Revenue / net sales", revenue, "money"),
    field("ordinary_income", "Ordinary business income", income, "money"),
    ...(recipe.outcome === "needs_review"
      ? []
      : [
          field(
            "depreciation_adjustment",
            "Supplied depreciation adjustment",
            depreciation,
            "money",
            2,
          ),
          field("one_time_adjustment", "Supplied one-time adjustment", oneTime, "money", 2),
          field("adjusted_net_income", "Explicit adjusted net income", adjusted, "money", 2),
        ]),
  ];
}
function printable(value: string): string {
  // Preserve distinct Unicode names explicitly even with the PDF's standard Latin font.
  return value.replace(
    /[^\x20-\x7e]/gu,
    (character) => `\\u{${character.codePointAt(0)?.toString(16)}}`,
  );
}
function pdfText(value: string): string {
  return printable(value).replace(/([\\()])/g, "\\$1");
}
function wrap(value: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of printable(value).split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = "";
    }
    for (let at = 0; at < word.length; at += width) {
      if (at) {
        lines.push(line);
        line = "";
      }
      line = line ? `${line} ${word.slice(at, at + width)}` : word.slice(at, at + width);
    }
  }
  if (line) lines.push(line);
  return lines;
}
/** Deterministic and complete PDF bytes. Text stubs are deliberately absent from this API. */
export function createDemoImportPdf(recipeId: string, context: DemoImportContext): Uint8Array {
  const fixture = demoImportFixtureFor(recipeId, context);
  const recipe = demoImportRecipe(recipeId);
  const fields = demoImportFields(fixture);
  const pageCount = recipe.category === "tax" ? 2 : 1;
  const streams: string[] = [];
  for (let page = 1; page <= pageCount; page++) {
    const commands: string[] = [];
    const text = (value: string, y: number, size = 10, bold = false) =>
      commands.push(
        `BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 44 ${y} Tm (${pdfText(value)}) Tj ET`,
      );
    commands.push("0.93 0.94 0.98 rg 0 700 612 92 re f 0.16 0.18 0.24 rg");
    text("KEYCADE / SYNTHETIC DEMO", 756, 12, true);
    text(page === 1 ? recipe.title : "Synthetic supporting schedule", 725, 17, true);
    text("FICTIONAL RECORD - NOT VALID TAX OR FINANCIAL EVIDENCE", 681, 9, true);
    text(`Period: ${recipe.period.start} to ${recipe.period.end} | Currency: USD`, 660);
    let y = 634;
    const rows = fields.filter((field) => field.provenance?.sourcePage === page);
    if (page === 2) {
      for (const line of wrap(`Business legal name: ${demoImportBusinessName(fixture)}`, 110)) {
        text(line, y, 8);
        y -= 11;
      }
      y -= 12;
      const income = fields.find((field) => field.key === "ordinary_income");
      if (income) {
        text(`Ordinary business income carried from page 1: USD ${income.value}`, y);
        y -= 30;
      }
    }
    for (const row of rows) {
      text(row.provenance?.sourceLabel ?? row.label, y, 9, true);
      y -= 16;
      const name = row.key === "business_name";
      for (const line of wrap(
        `${row.kind === "money" ? "USD " : ""}${row.value}`,
        name ? 110 : 76,
      )) {
        text(line, y, name ? 8 : 11);
        y -= name ? 11 : 15;
      }
      y -= 13;
    }
    if (page === 2 && recipe.outcome === "needs_review") {
      text("Adjustments: not supplied (unknown)", y);
      y -= 20;
      text("Adjusted net income: not supplied (unknown)", y);
      y -= 30;
    } else if (page === 2) {
      for (const line of wrap(
        "The explicitly supplied adjusted income equals ordinary income plus the two separately supplied adjustments shown above. These are fixture facts, not underwriting calculations or recommendations.",
        85,
      )) {
        text(line, y);
        y -= 15;
      }
      y -= 12;
    }
    text("DEMONSTRATION NOTES", y - 4, 9, true);
    y -= 24;
    for (const line of wrap(recipe.summary, 85)) {
      text(line, y, 9);
      y -= 14;
    }
    text("All names, accounts and amounts are fictional. Human review is required.", 57, 8);
    text(
      `${recipe.id} / recipe v1 / application revision ${fixture.applicationRevision} / page ${page} of ${pageCount}`,
      40,
      8,
    );
    streams.push(commands.join("\n"));
  }
  const pages = streams.map((_, index) => 5 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  for (const [index, stream] of streams.entries())
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  // Canonical context is content-bound, including Unicode and revision, without executable PDF features.
  const identity = Array.from(new TextEncoder().encode(JSON.stringify(fixture)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  let pdf = `%PDF-1.4\n% Keycade fixture identity ${identity}\n`;
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

/** Parse only our bounded identity header, then verify every original byte against the recipe. */
export function readDemoImportPdfFixture(bytes: Uint8Array): DemoImportFixture | null {
  if (bytes.length > 128 * 1024) return null;
  const header = new TextDecoder().decode(bytes.subarray(0, 4096));
  const match = /^%PDF-1\.4\n% Keycade fixture identity ([0-9a-f]{2,3500})\n/.exec(header);
  if (!match?.[1] || match[1].length % 2) return null;
  try {
    const identityBytes = Uint8Array.from(match[1].match(/../g) ?? [], (pair) =>
      Number.parseInt(pair, 16),
    );
    const parsed = demoImportFixtureSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(identityBytes)),
    );
    if (!parsed.success) return null;
    const expected = createDemoImportPdf(parsed.data.recipeId, parsed.data);
    if (expected.length !== bytes.length || expected.some((value, index) => value !== bytes[index]))
      return null;
    return parsed.data;
  } catch {
    return null;
  }
}
