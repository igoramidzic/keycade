import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { type FormEvent, useEffect, useState } from "react";

export type DocumentCategory =
  | "tax"
  | "bank_statement"
  | "financial_statement"
  | "business_legal"
  | "identification"
  | "signed"
  | "other";
export const categoryLabels: Record<DocumentCategory, string> = {
  tax: "Tax documents",
  bank_statement: "Bank statements",
  financial_statement: "Financial statements",
  business_legal: "Business/legal",
  identification: "Identification",
  signed: "Signed documents",
  other: "Other",
};
type ProcessingState = "queued" | "processing" | "classified" | "needs_review" | "failed";
type ExtractedField = {
  key: string;
  label: string;
  value: string;
  kind: "text" | "money" | "year";
};
export type DocumentProcessingData = {
  runId: string;
  state: ProcessingState;
  category: DocumentCategory | null;
  confidence: number | null;
  extractedFields: ExtractedField[];
  suggestedTasks: { id: string; title: string }[];
  manualCategory: DocumentCategory | null;
  overrides: {
    id: string;
    revision: number;
    category: DocumentCategory;
    reason: string;
    createdAt: string;
  }[];
  history: {
    id: string;
    generation: number;
    state: ProcessingState;
    attempts: number;
    stale: boolean;
    result: {
      category: DocumentCategory;
      confidence: number;
      extractedFields: ExtractedField[];
      completedAt: string;
    } | null;
    errorCode: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  errorCode: string | null;
  canRetry: boolean;
  canCorrectCategory: boolean;
};
const stateLabels: Record<ProcessingState, string> = {
  queued: "Queued for interpretation",
  processing: "Interpretation in progress",
  classified: "Suggested category ready",
  needs_review: "Interpretation needs review",
  failed: "Interpretation failed",
};
function SuggestedFields({ fields }: { fields: ExtractedField[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.key}>
          <dt className="text-muted-foreground">{field.label}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words font-medium">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DocumentInterpretation({
  processing,
  versionId,
  retry,
  correct,
  reload,
  errorMessage,
}: {
  processing: DocumentProcessingData;
  versionId: string;
  retry: () => Promise<unknown>;
  correct: (category: DocumentCategory, reason: string) => Promise<unknown>;
  reload: () => Promise<unknown>;
  errorMessage: (error: unknown) => string;
}) {
  const [category, setCategory] = useState<DocumentCategory>(
    processing.manualCategory ?? processing.category ?? "other",
  );
  const [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) setCategory(processing.manualCategory ?? processing.category ?? "other");
  }, [dirty, processing.manualCategory, processing.category]);
  async function act(operation: () => Promise<unknown>, notice: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      await reload();
      setNotice(notice);
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      await act(
        () => correct(category, reason.trim()),
        "Staff category saved. The original simulated result is preserved.",
      )
    ) {
      setReason("");
      setDirty(false);
    }
  }
  return (
    <section aria-label="Simulated document interpretation" className="space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium">Simulated interpretation</h4>
        <Badge variant={processing.state === "failed" ? "destructive" : "secondary"}>
          {stateLabels[processing.state]}
        </Badge>
      </div>
      {processing.state === "queued" || processing.state === "processing" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {processing.state === "queued" && processing.errorCode
            ? "A temporary interpretation error occurred. The demo will retry automatically; the original clean file remains available."
            : "The demo is interpreting this clean file. Results will appear here after the simulated delay."}
        </p>
      ) : null}
      {processing.state === "failed" && (
        <p className="text-sm text-muted-foreground">
          Interpretation could not finish. The original clean file remains available for download.
        </p>
      )}
      {processing.state === "needs_review" && (
        <p className="text-sm text-muted-foreground">
          {processing.category === "other"
            ? processing.manualCategory
              ? "The simulated interpreter could not identify this content. Its original result remains available for review."
              : "The simulated interpreter could not identify this content. It stays in Other for review."
            : "The suggested category has low confidence. Review the original file before relying on its suggested values."}
        </p>
      )}
      {processing.category && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <p>
            Original suggestion:{" "}
            <span className="font-medium">{categoryLabels[processing.category]}</span>
          </p>
          {processing.confidence !== null && (
            <p className="text-muted-foreground">
              Confidence: {Math.round(processing.confidence * 100)}%
            </p>
          )}
        </div>
      )}
      {processing.manualCategory && (
        <p className="text-sm">
          Staff category:{" "}
          <span className="font-medium">{categoryLabels[processing.manualCategory]}</span>
        </p>
      )}
      {processing.extractedFields.length > 0 && (
        <div className="space-y-3 rounded-lg bg-muted/40 p-3">
          <h5 className="text-sm font-medium">Suggested fields · Simulated, unverified</h5>
          <SuggestedFields fields={processing.extractedFields} />
          <p className="text-xs leading-5 text-muted-foreground">
            These suggestions do not change confirmed application values.
          </p>
        </div>
      )}
      {processing.suggestedTasks.length > 0 && (
        <div className="space-y-2 text-sm">
          <h5 className="font-medium">Suggested task matches</h5>
          <ul className="list-disc space-y-1 pl-5">
            {processing.suggestedTasks.map((task) => (
              <li key={task.id}>{task.title}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Matches do not change task evidence or complete requirements. Bank review is still
            required.
          </p>
        </div>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Interpretation action incomplete</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {processing.canRetry && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void act(retry, "Simulated interpretation queued again.")}
        >
          {busy
            ? "Working…"
            : processing.state === "failed"
              ? "Retry interpretation"
              : "Interpret again"}
        </Button>
      )}
      {processing.canCorrectCategory && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Correct category</summary>
          <form
            onSubmit={(event) => void save(event)}
            className="mt-3 space-y-3 rounded-lg border p-3"
          >
            <div className="space-y-2">
              <label htmlFor={`category-${versionId}`} className="text-sm">
                Staff category
              </label>
              <NativeSelect
                id={`category-${versionId}`}
                className="w-full"
                value={category}
                disabled={busy}
                onChange={(event) => {
                  setCategory(event.target.value as DocumentCategory);
                  setDirty(true);
                  setNotice(null);
                }}
              >
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <label htmlFor={`category-reason-${versionId}`} className="text-sm">
                Correction reason
              </label>
              <textarea
                id={`category-reason-${versionId}`}
                className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                required
                maxLength={1000}
                value={reason}
                disabled={busy}
                onChange={(event) => {
                  setReason(event.target.value);
                  setDirty(true);
                  setNotice(null);
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This changes the displayed category for this version. The original suggestion and
              correction history remain available.
            </p>
            <Button type="submit" size="sm" disabled={busy || !reason.trim()}>
              {busy ? "Saving…" : "Save staff category"}
            </Button>
          </form>
        </details>
      )}
      {(processing.overrides.length > 0 || processing.history.length > 0) && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Interpretation history</summary>
          <div className="mt-3 space-y-4 text-sm">
            {processing.overrides.length > 0 && (
              <section aria-label="Category corrections" className="space-y-3">
                <h5 className="font-medium">Staff corrections</h5>
                {processing.overrides.map((override) => (
                  <div key={override.id} className="space-y-1 border-l-2 pl-3">
                    <p>
                      {categoryLabels[override.category]} · Correction {override.revision}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-muted-foreground">
                      {override.reason}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(override.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </section>
            )}
            {processing.history.length > 0 && (
              <section aria-label="Simulated interpretation runs" className="space-y-3">
                <h5 className="font-medium">Simulated runs</h5>
                {processing.history.map((run) => (
                  <div key={run.id} className="space-y-2 border-l-2 pl-3">
                    <p>
                      Run {run.generation} · {stateLabels[run.state]}
                      {run.stale ? " · Historical result" : ""}
                    </p>
                    {run.result && (
                      <>
                        <p className="text-muted-foreground">
                          Original suggestion: {categoryLabels[run.result.category]} ·{" "}
                          {Math.round(run.result.confidence * 100)}% confidence
                        </p>
                        {run.result.extractedFields.length > 0 && (
                          <SuggestedFields fields={run.result.extractedFields} />
                        )}
                      </>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(run.updatedAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </section>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
