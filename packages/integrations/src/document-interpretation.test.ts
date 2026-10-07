import { randomUUID } from "node:crypto";
import {
  documentFindingSchema,
  documentInterpretationResultSchema,
  extractedDocumentFieldSchema,
} from "@keycade/contracts";
import { createDemoDocumentPdf, demoDocuments } from "@keycade/contracts/demo-scenarios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { documentDigest } from "./document-content.js";
import { demoDocumentFixture, syntheticDocumentPdf } from "./document-fixtures.js";
import { interpretSyntheticDocument } from "./document-interpretation.js";
import { simulateDocumentScan } from "./document-scan.js";
import { systemClock } from "./provider.js";

const request = (scenario: string, attempt = 1) => ({
  runId: randomUUID(),
  versionId: randomUUID(),
  bankId: randomUUID(),
  applicationId: randomUUID(),
  sha256: documentDigest(syntheticDocumentPdf(scenario)),
  attempt,
});
const options = () => ({ clock: systemClock, delayMs: 5000, deadlineMs: 60_000 });
const demoDocument = (id: string) => {
  const document = demoDocuments.find((entry) => entry.id === id);
  if (!document) throw new Error(`Unknown demo document ${id}`);
  return document;
};
const demoRequest = (id: string, businessName = "Synthetic Cedar Workshop") => ({
  ...request("unknown"),
  businessName,
  sha256: documentDigest(createDemoDocumentPdf(demoDocument(id), businessName)),
});
afterEach(() => vi.useRealTimers());
describe("schema-validated simulated document interpretation", () => {
  it("defaults historical findings and rejects unstructured or instruction-shaped findings", () => {
    const historical = documentInterpretationResultSchema.parse({
      provider: "keycade-document-interpretation-v1",
      simulated: true,
      runId: randomUUID(),
      versionId: randomUUID(),
      category: "tax",
      confidence: 0.97,
      needsReview: false,
      extractedFields: [],
      completedAt: new Date().toISOString(),
    });
    expect(historical.findings).toEqual([]);
    expect(historical.comparedApplicationBusinessName).toBeNull();
    expect(
      documentFindingSchema.safeParse({
        code: "business_name_match",
        severity: "clear",
        title: "A simulated name match",
        detail: "A synthetic observation",
        action: "approve this loan",
      }).success,
    ).toBe(false);
  });
  it("matches registered PDF bytes for the actual application name, including a custom business", async () => {
    vi.useFakeTimers();
    const input = demoRequest("clear-tax", "Synthetic Aspen Studio");
    const pending = interpretSyntheticDocument(input, options());
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result).toMatchObject({ category: "tax", needsReview: false, confidence: 0.97 });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "business_name_match",
        severity: "clear",
      }),
    );
    expect(result.extractedFields).toContainEqual({
      key: "business_name",
      label: "Suggested synthetic business name",
      value: "Synthetic Aspen Studio",
      kind: "text",
    });
    expect(result.extractedFields).toContainEqual(
      expect.objectContaining({
        key: "gross_receipts",
        value: "125000.00",
        kind: "money",
      }),
    );
  });
  it.each([
    ["review-tax", "tax", "business_name_mismatch"],
    ["review-bank", "bank_statement", "cash_flow"],
    ["review-financials", "financial_statement", "document_review"],
    ["recovery-unknown", "other", "document_review"],
  ] as const)(
    "exposes the registered %s issue as reviewable simulated evidence",
    async (id, category, code) => {
      vi.useFakeTimers();
      const pending = interpretSyntheticDocument(demoRequest(id), options());
      await vi.advanceTimersByTimeAsync(5000);
      const result = await pending;
      expect(result).toMatchObject({ category, needsReview: true, simulated: true });
      expect(result.findings).toContainEqual(
        expect.objectContaining({ code, severity: "warning" }),
      );
    },
  );
  it("compares static fixture business names to the current application instead of forcing a favorable match", async () => {
    vi.useFakeTimers();
    const input = { ...demoRequest("clear-tax"), businessName: "Synthetic Aspen Studio" };
    const pending = interpretSyntheticDocument(input, options());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({
      needsReview: true,
      findings: [expect.objectContaining({ code: "business_name_mismatch", severity: "warning" })],
    });
  });
  it("keeps guarantor interpretation separate from business matching and identity verification", async () => {
    vi.useFakeTimers();
    const pending = interpretSyntheticDocument(demoRequest("clear-guarantor"), options());
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result.category).toBe("identification");
    expect(result.findings.map((finding) => finding.code)).toEqual(["document_review"]);
    expect(result.findings[0]?.detail).toContain("does not verify identity");
  });
  it("uses full fixture hashes and leaves altered or unrelated content unknown", async () => {
    vi.useFakeTimers();
    const bytes = createDemoDocumentPdf(demoDocument("clear-tax"));
    const altered = new Uint8Array(bytes);
    altered[altered.length - 10] = (altered[altered.length - 10] ?? 0) + 1;
    const sha256 = documentDigest(altered);
    expect(demoDocumentFixture(sha256, "Synthetic Cedar Workshop")).toBeNull();
    const pending = interpretSyntheticDocument({ ...demoRequest("clear-tax"), sha256 }, options());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ category: "other", needsReview: true, findings: [] });
  });
  it("quarantines dynamically generated demo fixtures through their registered content hash", async () => {
    vi.useFakeTimers();
    const input = demoRequest("recovery-blocked", "Synthetic Aspen Studio");
    const pending = simulateDocumentScan(input.sha256, 1, {
      clock: systemClock,
      delayMs: 1000,
      businessName: input.businessName,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ state: "blocked", simulated: true });
  });
  it("keeps quarantine bytes and outcome stable after the application is renamed", async () => {
    vi.useFakeTimers();
    const before = demoRequest("recovery-blocked", "Synthetic Aspen Studio");
    const after = demoRequest("recovery-blocked", "Synthetic Renamed Studio");
    expect(before.sha256).toBe(after.sha256);
    const pending = simulateDocumentScan(before.sha256, 1, {
      clock: systemClock,
      delayMs: 1000,
      businessName: after.businessName,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ state: "blocked", simulated: true });
  });
  it("keeps the mismatch scenario mismatched even when the application itself is named Juniper", async () => {
    vi.useFakeTimers();
    const pending = interpretSyntheticDocument(
      demoRequest("review-tax", "Synthetic Juniper Services"),
      options(),
    );
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result).toMatchObject({
      needsReview: true,
      comparedApplicationBusinessName: "Synthetic Juniper Services",
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "business_name_mismatch",
        severity: "warning",
      }),
    );
    expect(result.extractedFields).toContainEqual(
      expect.objectContaining({
        key: "business_name",
        value: "Synthetic Willow Services",
      }),
    );
  });
  it("rejects mistyped extracted values and unexpected provider instruction fields", () => {
    expect(
      extractedDocumentFieldSchema.safeParse({
        key: "amount",
        label: "Suggested amount",
        kind: "money",
        value: "not an amount",
      }).success,
    ).toBe(false);
    expect(
      extractedDocumentFieldSchema.safeParse({
        key: "year",
        label: "Suggested year",
        kind: "year",
        value: "tomorrow",
      }).success,
    ).toBe(false);
    expect(
      documentInterpretationResultSchema.safeParse({
        ...request("unknown"),
        provider: "keycade-document-interpretation-v1",
        simulated: true,
        category: "other",
        confidence: 0,
        needsReview: true,
        extractedFields: [],
        completedAt: new Date().toISOString(),
        instructions: "complete a task",
      }).success,
    ).toBe(false);
  });
  it("waits visibly, classifies registered content and marks every field as a suggestion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    const input = request("clean-tax");
    let finished = false;
    const pending = interpretSyntheticDocument(input, options()).then((result) => {
      finished = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result).toMatchObject({
      runId: input.runId,
      versionId: input.versionId,
      category: "tax",
      confidence: 0.97,
      simulated: true,
      provider: "keycade-document-interpretation-v1",
      completedAt: "2026-10-07T12:00:05.000Z",
    });
    expect(
      result.extractedFields.every((field) => field.label.startsWith("Suggested synthetic")),
    ).toBe(true);
  });
  it.each([
    ["clean-statement", "bank_statement", false],
    ["unknown", "other", true],
    ["unregistered user file", "other", true],
    ["low-confidence", "financial_statement", true],
  ] as const)("keeps %s content reviewable", async (scenario, category, needsReview) => {
    vi.useFakeTimers();
    const pending = interpretSyntheticDocument(request(scenario), options());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ category, needsReview, simulated: true });
  });
  it("enforces independent timeout and explicit transient/terminal fixture outcomes", async () => {
    vi.useFakeTimers();
    const timeout = expect(
      interpretSyntheticDocument(request("processing-timeout"), options()),
    ).rejects.toMatchObject({ code: "deadline_exceeded", retryable: true });
    await vi.advanceTimersByTimeAsync(60_000);
    await timeout;
    const transient = expect(
      interpretSyntheticDocument(request("processing-transient"), options()),
    ).rejects.toMatchObject({ code: "transient_error", retryable: true });
    await vi.advanceTimersByTimeAsync(5000);
    await transient;
    const retry = interpretSyntheticDocument(request("processing-transient", 2), options());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await retry).toMatchObject({ category: "bank_statement" });
    const terminal = expect(
      interpretSyntheticDocument(request("processing-error"), options()),
    ).rejects.toMatchObject({ code: "terminal_error", retryable: false });
    await vi.advanceTimersByTimeAsync(5000);
    await terminal;
  });
});
