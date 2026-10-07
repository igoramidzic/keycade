import {
  type DocumentInterpretationResult,
  documentInterpretationResultSchema,
} from "@keycade/contracts";
import { documentFixtureScenario } from "./document-fixtures.js";
import { ProviderError, type ProviderOptions } from "./provider.js";

export interface DocumentInterpretationRequest {
  runId: string;
  versionId: string;
  bankId: string;
  applicationId: string;
  sha256: string;
  attempt: number;
}

/** Registered synthetic content hashes, never filenames, select the deterministic demo result. */
export async function interpretSyntheticDocument(
  request: DocumentInterpretationRequest,
  options: ProviderOptions,
): Promise<DocumentInterpretationResult> {
  const scenario = documentFixtureScenario(request.sha256);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const operation = async () => {
    await options.clock.sleep(
      scenario === "processing-timeout" ? options.deadlineMs + 1 : options.delayMs,
      controller.signal,
    );
    if (scenario === "processing-error") throw new ProviderError("terminal_error", false);
    if (scenario === "processing-transient" && request.attempt === 1)
      throw new ProviderError("transient_error", true);
    const tax = scenario === "clean-tax";
    const statement = scenario === "clean-statement" || scenario === "processing-transient";
    const lowConfidence = scenario === "low-confidence";
    return documentInterpretationResultSchema.parse({
      provider: "keycade-document-interpretation-v1",
      simulated: true,
      runId: request.runId,
      versionId: request.versionId,
      category: tax
        ? "tax"
        : statement
          ? "bank_statement"
          : lowConfidence
            ? "financial_statement"
            : "other",
      confidence: tax ? 0.97 : statement ? 0.96 : lowConfidence ? 0.42 : 0,
      needsReview: !(tax || statement),
      extractedFields: tax
        ? [
            { key: "tax_year", label: "Suggested synthetic tax year", value: "2025", kind: "year" },
            {
              key: "gross_receipts",
              label: "Suggested synthetic gross receipts",
              value: "125000.00",
              kind: "money",
            },
          ]
        : statement
          ? [
              {
                key: "statement_period",
                label: "Suggested synthetic statement period",
                value: "August 2026",
                kind: "text",
              },
              {
                key: "closing_balance",
                label: "Suggested synthetic closing balance",
                value: "25000.00",
                kind: "money",
              },
            ]
          : [],
      completedAt: options.clock.now().toISOString(),
    });
  };
  const deadline = options.clock.sleep(options.deadlineMs, controller.signal).then(() => {
    throw new ProviderError("deadline_exceeded", true);
  });
  try {
    return await Promise.race([operation(), deadline]);
  } finally {
    controller.abort();
    options.signal?.removeEventListener("abort", abort);
  }
}
