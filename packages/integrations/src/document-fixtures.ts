import { documentDigest } from "./document-content.js";

export function syntheticDocumentPdf(scenario: string): Uint8Array {
  const text = `KEYCADE SYNTHETIC DOCUMENT - ${scenario.replace(/[^a-z0-9 -]/gi, "")}`;
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
export const documentFixtureScenarios = [
  "clean-tax",
  "clean-statement",
  "unknown",
  "low-confidence",
  "blocked",
  "scan-error",
  "scan-transient",
] as const;
export type DocumentFixtureScenario = (typeof documentFixtureScenarios)[number];
const fixtures = new Map(
  documentFixtureScenarios.map((scenario) => [
    documentDigest(syntheticDocumentPdf(scenario)),
    scenario,
  ]),
);
export function documentFixtureScenario(sha256: string): DocumentFixtureScenario | "unregistered" {
  return fixtures.get(sha256) ?? "unregistered";
}
