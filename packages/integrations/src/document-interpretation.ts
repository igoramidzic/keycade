import {
  type DocumentFinding,
  type DocumentInterpretationResult,
  documentInterpretationResultSchema,
} from "@keycade/contracts";
import { demoDocumentFixture, documentFixtureScenario } from "./document-fixtures.js";
import { ProviderError, type ProviderOptions } from "./provider.js";

export interface DocumentInterpretationRequest {
  runId: string;
  versionId: string;
  bankId: string;
  applicationId: string;
  sha256: string;
  attempt: number;
  businessName?: string | null;
}

const normalizeBusinessName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

function demoResult(
  fixture: NonNullable<ReturnType<typeof demoDocumentFixture>>,
  applicationBusinessName: string | null | undefined,
) {
  const { document, businessName } = fixture;
  const findings: DocumentFinding[] = [];
  if (document.subject === "business") {
    if (applicationBusinessName) {
      const matches =
        normalizeBusinessName(businessName) === normalizeBusinessName(applicationBusinessName);
      findings.push({
        code: matches ? "business_name_match" : "business_name_mismatch",
        severity: matches ? "clear" : "warning",
        title: matches ? "Business name matches" : "Business name does not match",
        detail: matches
          ? `The synthetic document names ${businessName}, matching this application's business name.`
          : `The synthetic document names ${businessName}; this application names ${applicationBusinessName}. Ask for a corrected document.`,
      });
    } else {
      findings.push({
        code: "document_review",
        severity: "warning",
        title: "Business name needs review",
        detail: "An application business name is needed before comparing this synthetic document.",
      });
    }
  }
  if (document.outcome === "cash_flow")
    findings.push({
      code: "cash_flow",
      severity: "warning",
      title: "Cash flow needs review",
      detail: document.summary,
    });
  else if (document.category === "bank_statement")
    findings.push({
      code: "cash_flow",
      severity: "clear",
      title: "Cash flow looks consistent",
      detail: document.summary,
    });
  if (["low_confidence", "unknown"].includes(document.outcome))
    findings.push({
      code: "document_review",
      severity: "warning",
      title: "Document needs review",
      detail: document.summary,
    });
  if (document.subject === "guarantor")
    findings.push({
      code: "document_review",
      severity: "clear",
      title: "Guarantor document ready for review",
      detail:
        "This registered synthetic document is available for the assigned person's review. It does not verify identity or guarantee approval.",
    });
  const extractedFields: DocumentInterpretationResult["extractedFields"] = [
    {
      key: "business_name",
      label: "Suggested synthetic business name",
      value: businessName,
      kind: "text",
    },
    ...document.rows.map((row) => {
      const amount = row.value.replace(/[$,]/g, "");
      const kind =
        /year/i.test(row.label) && /^\d{4}$/.test(row.value)
          ? ("year" as const)
          : /receipts|revenue|balance|deposit|withdrawal|expense|profit|income/i.test(row.label) &&
              /^\d{1,18}\.\d{2}$/.test(amount)
            ? ("money" as const)
            : ("text" as const);
      return {
        key: row.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .slice(0, 80),
        label: `Suggested synthetic ${row.label}`,
        value: kind === "money" ? amount : row.value,
        kind,
      };
    }),
  ];
  return {
    category: document.category,
    confidence:
      document.outcome === "unknown" ? 0 : document.outcome === "low_confidence" ? 0.42 : 0.97,
    needsReview: findings.some((finding) => finding.severity === "warning"),
    extractedFields,
    findings,
    comparedApplicationBusinessName:
      document.subject === "business" ? (applicationBusinessName ?? null) : null,
  };
}

/** Registered synthetic content hashes, never filenames, select the deterministic demo result. */
export async function interpretSyntheticDocument(
  request: DocumentInterpretationRequest,
  options: ProviderOptions,
): Promise<DocumentInterpretationResult> {
  const scenario = documentFixtureScenario(request.sha256);
  const demo = demoDocumentFixture(request.sha256, request.businessName);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const operation = async () => {
    await options.clock.sleep(
      scenario === "processing-timeout" ? options.deadlineMs + 1 : options.delayMs,
      controller.signal,
    );
    if (scenario === "processing-error" || demo?.document.outcome === "processing_error")
      throw new ProviderError("terminal_error", false);
    if (
      (scenario === "processing-transient" || demo?.document.outcome === "processing_transient") &&
      request.attempt === 1
    )
      throw new ProviderError("transient_error", true);
    if (demo)
      return documentInterpretationResultSchema.parse({
        provider: "keycade-document-interpretation-v1",
        simulated: true,
        runId: request.runId,
        versionId: request.versionId,
        ...demoResult(demo, request.businessName),
        completedAt: options.clock.now().toISOString(),
      });
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
