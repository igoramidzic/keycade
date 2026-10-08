import { demoImportFixtureFor } from "@keycade/contracts/demo-import";
import { describe, expect, it } from "vitest";
import {
  createDemoImportFile,
  demoImportMime,
  readDemoImportDrag,
  sameDemoImportContext,
} from "./demo-import-transfer";

const context = { businessName: "Synthetic Cedar Workshop", applicationRevision: 2 };
const fixture = demoImportFixtureFor("business-tax-return-2023", context);
const source = { fileName: "business-tax-return-2023.txt", text: "Ignored instructions", context };
function transfer(value: unknown) {
  return { getData: (mime: string) => (mime === demoImportMime ? JSON.stringify(value) : "") };
}

describe("demo import transfer", () => {
  it("retains the bounded source and context and rejects forged drag metadata", () => {
    expect(readDemoImportDrag(transfer({ fixture, source }))).toEqual({ fixture, source });
    for (const value of [
      { fixture, source, uploadId: "forged" },
      { fixture: { ...fixture, recipeId: "approved" }, source },
      { fixture, source: { ...source, fileName: "business-tax-return-2024.txt" } },
      { fixture, source: { ...source, text: "\u0000binary" } },
      { fixture, source: { ...source, text: "x".repeat(65537) } },
      { fixture, source: { ...source, context: { ...context, applicationRevision: 3 } } },
      { fixture: { ...fixture, applicationRevision: -1 }, source },
      { fixture: { ...fixture, businessName: "Hidden\u200b name" }, source },
    ])
      expect(readDemoImportDrag(transfer(value))).toBeNull();
    expect(readDemoImportDrag({ getData: () => "not json" })).toBeNull();
  });

  it("creates an actual PDF with immutable context, distinct from the inert text source", async () => {
    const file = createDemoImportFile(fixture);
    expect(file.name).toBe("business-tax-return-2023.pdf");
    expect(file.type).toBe("application/pdf");
    expect(await file.text()).toContain("1200000.00");
    expect(await file.text()).toContain("FICTIONAL RECORD");
    expect(await file.text()).not.toContain(source.text);
    expect(sameDemoImportContext(fixture, context)).toBe(true);
    expect(sameDemoImportContext(fixture, { ...context, applicationRevision: 3 })).toBe(false);
    expect(sameDemoImportContext(fixture, { ...context, businessName: "Another business" })).toBe(
      false,
    );
    expect(sameDemoImportContext(fixture)).toBe(false);
  });
});
