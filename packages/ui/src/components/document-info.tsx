import type {
  DocumentCategory,
  DocumentVersion,
  DocumentView,
  UpdateDocumentMetadata,
} from "@keycade/contracts";
import { documentCategoryLabels } from "@keycade/contracts";
import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Button } from "@keycade/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import { Input } from "@keycade/ui/components/input";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { Textarea } from "@keycade/ui/components/textarea";
import { workflowName } from "@keycade/ui/lib/workflow-text";
import { ChevronRight } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

export function DocumentInfo({
  document,
  version,
  update,
  correctCategory,
  reload,
  errorMessage,
}: {
  document: DocumentView;
  version: DocumentVersion;
  update: (input: UpdateDocumentMetadata) => Promise<unknown>;
  correctCategory: (
    category: DocumentCategory,
    reason: string,
    expectedRevision: number,
  ) => Promise<unknown>;
  reload: () => Promise<unknown>;
  errorMessage: (error: unknown) => string;
}) {
  const [displayName, setDisplayName] = useState(version.metadata.displayName ?? "");
  const [description, setDescription] = useState(version.metadata.description ?? "");
  const [start, setStart] = useState(version.metadata.expectedPeriod?.start ?? "");
  const [end, setEnd] = useState(version.metadata.expectedPeriod?.end ?? "");
  const [basis, setBasis] = useState<"fiscal_year" | "statement">(
    version.metadata.expectedPeriod?.basis ?? "fiscal_year",
  );
  const [revision, setRevision] = useState(version.metadata.revision);
  const [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedCategory =
    version.processing?.manualCategory ?? version.processing?.category ?? "other";
  const [category, setCategory] = useState<DocumentCategory>(selectedCategory);
  const [categoryReason, setCategoryReason] = useState("");
  const [categoryRevision, setCategoryRevision] = useState(
    version.processing?.overrides[0]?.revision ?? 0,
  );
  const [categoryDirty, setCategoryDirty] = useState(false);
  const current = document.currentVersionId === version.id;
  useEffect(() => {
    if (dirty) return;
    setDisplayName(version.metadata.displayName ?? "");
    setDescription(version.metadata.description ?? "");
    setStart(version.metadata.expectedPeriod?.start ?? "");
    setEnd(version.metadata.expectedPeriod?.end ?? "");
    setBasis(version.metadata.expectedPeriod?.basis ?? "fiscal_year");
    setRevision(version.metadata.revision);
  }, [dirty, version.metadata]);
  useEffect(() => {
    if (categoryDirty) return;
    setCategory(selectedCategory);
    setCategoryRevision(version.processing?.overrides[0]?.revision ?? 0);
  }, [categoryDirty, selectedCategory, version.processing?.overrides]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await update({
        versionId: version.id,
        expectedRevision: revision,
        displayName: displayName.trim() || null,
        description: description.trim() || null,
        expectedPeriod: start && end ? { start, end, basis } : null,
        reason: reason.trim(),
      });
      setDirty(false);
      setReason("");
      await reload();
      setNotice("Document details saved. The previous values remain in history.");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const fields = [
    ["Display name", version.metadata.displayName ?? version.fileName],
    ["Original filename", version.fileName],
    ["Description", version.metadata.description ?? "Not provided"],
    ["Document type", `${documentCategoryLabels[selectedCategory]} · ${version.mimeType}`],
    [
      "Analysis recipe",
      version.demoImportFixture
        ? `${version.demoImportFixture.recipeId} · recipe ${version.demoImportFixture.recipeVersion}`
        : "Content-based interpretation",
    ],
    ["Associated business", workflowName(document.applicationBusinessName ?? "Not provided")],
    [
      "Subject",
      workflowName(document.subjectDisplayName) ||
        (document.visibility === "private" ? "Private participant" : "Application business"),
    ],
    ["Application", document.applicationId ?? "Current application"],
    [
      "Expected period",
      version.metadata.expectedPeriod
        ? `${version.metadata.expectedPeriod.start} to ${version.metadata.expectedPeriod.end} (${version.metadata.expectedPeriod.basis.replaceAll("_", " ")})`
        : "Not provided",
    ],
    ["Uploader", workflowName(version.uploadedByName ?? "Historical uploader unavailable")],
    [
      "Extracted period",
      version.processing?.extractedFields.find((field) => field.provenance)?.provenance
        ? [
            ...new Set(
              version.processing.extractedFields.flatMap((field) =>
                field.provenance
                  ? [`${field.provenance.period.start} to ${field.provenance.period.end}`]
                  : [],
              ),
            ),
          ].join(", ")
        : "Not available",
    ],
    ["Uploaded", new Date(version.uploadedAt ?? version.createdAt).toLocaleString()],
    ["Version", `${version.version}${current ? " · Current" : " · Historical"}`],
    [
      "Processing status",
      version.processing?.state.replaceAll("_", " ") ?? "Awaiting a clean scan",
    ],
    [
      "Written-response policy",
      document.writtenResponsePolicy?.replaceAll("_", " ") ?? "No linked requirement",
    ],
  ];
  return (
    <section aria-label="Document info" className="space-y-4 border-t pt-5">
      <h3 className="font-medium">Document info</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-words whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
      </dl>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Details were not saved</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{error}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDirty(false);
                setCategoryDirty(false);
                setCategoryReason("");
                setError(null);
                void reload().catch((failure) => setError(errorMessage(failure)));
              }}
            >
              Reload latest metadata
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {document.canEditMetadata && current && (
        <Collapsible className="rounded-lg border p-3">
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-sm font-medium w-full text-left">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform in-data-panel-open:rotate-90"
            />
            Edit document details
          </CollapsibleTrigger>
          <CollapsibleContent>
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => void save(event)}
              onChange={() => setDirty(true)}
            >
              <label className="block space-y-1 text-sm">
                Display name
                <Input
                  value={displayName}
                  maxLength={180}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="block space-y-1 text-sm">
                Description
                <Textarea
                  value={description}
                  maxLength={2000}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 text-sm">
                  Expected period start
                  <Input
                    type="date"
                    value={start}
                    required={Boolean(end)}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  Expected period end
                  <Input
                    type="date"
                    value={end}
                    min={start || undefined}
                    required={Boolean(start)}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                Period basis
                <NativeSelect
                  value={basis}
                  onChange={(event) => setBasis(event.target.value as typeof basis)}
                >
                  <option value="fiscal_year">Fiscal year</option>
                  <option value="statement">Statement</option>
                </NativeSelect>
              </label>
              <p className="text-xs text-muted-foreground">
                Changing the expected period requires a fresh source review. Clear both dates to
                remove the expected period.
              </p>
              <label className="block space-y-1 text-sm">
                Reason for metadata change
                <Textarea
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <Button
                loading={busy}
                type="submit"
                size="sm"
                disabled={busy || !dirty || !reason.trim()}
              >
                Save document details
              </Button>
            </form>
          </CollapsibleContent>
        </Collapsible>
      )}
      {version.processing?.canCorrectCategory && current && (
        <Collapsible className="rounded-lg border p-3">
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-sm font-medium w-full text-left">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform in-data-panel-open:rotate-90"
            />
            Correct document category
          </CollapsibleTrigger>
          <CollapsibleContent>
            <form
              className="mt-4 space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError(null);
                setNotice(null);
                try {
                  await correctCategory(category, categoryReason.trim(), categoryRevision);
                  await reload();
                  setCategoryReason("");
                  setCategoryDirty(false);
                  setNotice(
                    "Category corrected. The original suggestion is preserved; review any stale financial sources.",
                  );
                } catch (failure) {
                  setError(errorMessage(failure));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="block space-y-1 text-sm">
                Document category
                <NativeSelect
                  value={category}
                  onChange={(event) => {
                    setCategoryDirty(true);
                    setCategory(event.target.value as DocumentCategory);
                  }}
                >
                  {Object.entries(documentCategoryLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="block space-y-1 text-sm">
                Reason for category correction
                <Textarea
                  required
                  maxLength={1000}
                  value={categoryReason}
                  onChange={(event) => {
                    setCategoryDirty(true);
                    setCategoryReason(event.target.value);
                  }}
                />
              </label>
              <Button type="submit" size="sm" disabled={busy || !categoryReason.trim()}>
                Save category correction
              </Button>
            </form>
          </CollapsibleContent>
        </Collapsible>
      )}
      {!document.canEditMetadata && (
        <p className="text-xs text-muted-foreground">
          Details are read-only at this application stage. Use the existing return-for-information
          workflow before changing decision inputs.
        </p>
      )}
    </section>
  );
}
