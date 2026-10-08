import {
  createDemoImportPdf,
  type DemoImportContext,
  type DemoImportFixture,
  demoImportFields,
  demoImportFixtureFor,
  demoImportFixtureSchema,
  demoImportRecipe,
  demoImportRecipes,
} from "@keycade/contracts/demo-import";
import {
  createDemoDocumentPdf,
  type DemoDocument,
  demoDocumentBusinessName,
  demoDocuments,
  demoScenarios,
} from "@keycade/contracts/demo-scenarios";
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
  "processing-transient",
  "processing-error",
  "processing-timeout",
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

/** Finite, generated fixture content selects demo results; arbitrary PDF text never does. */
export function demoDocumentFixture(
  sha256: string,
  applicationBusinessName?: string | null,
): { document: DemoDocument; businessName: string } | null {
  for (const document of demoDocuments) {
    const scenario = demoScenarios.find((candidate) =>
      candidate.documents.some((entry) => entry.id === document.id),
    );
    if (!scenario) continue;
    const names = new Set([scenario.business.name]);
    if (applicationBusinessName) names.add(applicationBusinessName);
    for (const name of names) {
      if (documentDigest(createDemoDocumentPdf(document, name)) === sha256)
        return { document, businessName: demoDocumentBusinessName(document, name) };
    }
  }
  return null;
}

/** Stored identity is only a hint: regeneration must match the complete uploaded content digest. */
export function demoImportDocumentFixture(
  sha256: string,
  contextOrFixture: DemoImportContext | DemoImportFixture,
) {
  const metadata =
    "recipeId" in contextOrFixture
      ? [contextOrFixture]
      : demoImportRecipes.map((recipe) => demoImportFixtureFor(recipe.id, contextOrFixture));
  for (const input of metadata) {
    const parsed = demoImportFixtureSchema.safeParse(input);
    if (!parsed.success) continue;
    const fixture = parsed.data;
    if (documentDigest(createDemoImportPdf(fixture.recipeId, fixture)) === sha256) {
      return {
        recipe: demoImportRecipe(fixture.recipeId),
        fixture,
        fields: demoImportFields(fixture),
      };
    }
  }
  return null;
}
