import { demoDocuments } from "@keycade/contracts/demo-scenarios";
import { describe, expect, it } from "vitest";
import {
  createDemoDocumentFile,
  demoDocumentMime,
  readDemoDocumentDrag,
} from "./demo-document-transfer";

function transfer(value: unknown) {
  return {
    getData: (type: string) => (type === demoDocumentMime ? JSON.stringify(value) : ""),
  };
}

describe("demo document transfer", () => {
  it("accepts only a catalog document and a bounded business name", () => {
    const document = demoDocuments.find((item) => item.id === "clear-tax");
    expect(
      readDemoDocumentDrag(transfer({ id: "clear-tax", businessName: "Synthetic Oak" })),
    ).toEqual({ document, businessName: "Synthetic Oak" });
    for (const value of [
      null,
      [],
      { id: "unknown", businessName: "Synthetic Oak" },
      { id: "clear-tax", businessName: "" },
      { id: "clear-tax", businessName: "x".repeat(201) },
      { id: "clear-tax", businessName: "Synthetic\nOak" },
      { id: "clear-tax", businessName: "Synthetic Oak", taskId: "forged" },
      { id: "clear-tax", businessName: "Synthetic Oak", content: "forged PDF" },
    ])
      expect(readDemoDocumentDrag(transfer(value))).toBeNull();
    expect(readDemoDocumentDrag({ getData: () => "not JSON" })).toBeNull();
  });

  it("creates an actual PDF File synchronously for the ordinary upload pipeline", async () => {
    const document = demoDocuments.find((item) => item.id === "clear-tax");
    if (!document) throw new Error("Missing tax-return fixture");
    const file = createDemoDocumentFile(document, "Synthetic Oak");
    expect(file.name).toBe(document.fileName);
    expect(file.type).toBe("application/pdf");
    expect(file.size).toBeGreaterThan(100);
    expect((await file.text()).startsWith("%PDF-")).toBe(true);
    expect(await file.text()).toContain("Synthetic Oak");
  });
});
