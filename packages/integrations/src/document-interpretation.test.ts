import { randomUUID } from "node:crypto";
import {
  documentInterpretationResultSchema,
  extractedDocumentFieldSchema,
} from "@keycade/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { documentDigest } from "./document-content.js";
import { syntheticDocumentPdf } from "./document-fixtures.js";
import { interpretSyntheticDocument } from "./document-interpretation.js";
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
afterEach(() => vi.useRealTimers());
describe("schema-validated simulated document interpretation", () => {
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
