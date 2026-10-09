import {
  type DemoImportContext,
  demoImportBusinessName,
  demoImportFields,
  demoImportFixtureFor,
  demoImportMaxBytes,
  demoImportMaxFiles,
  demoImportRecipes,
  validateDemoTextImportBatch,
} from "@keycade/contracts/demo-import";
import { Button } from "@keycade/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import type { DemoUploadTarget } from "@keycade/ui/components/demo-kit";
import { DemoDestination, DemoStepHeading } from "@keycade/ui/components/demo-kit-parts";
import {
  createDemoImportFile,
  type DemoImportPreview,
  demoImportMime,
  sameDemoImportContext,
} from "@keycade/ui/lib/demo-import-transfer";
import { workflowName, workflowText } from "@keycade/ui/lib/workflow-text";
import { cn } from "cn";
import { ChevronDown, Download, FileText, GripVertical, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function DemoTextImporter({
  step,
  uploadTarget,
}: {
  /** Position in the demo kit's numbered sections. */
  step: number;
  uploadTarget: DemoUploadTarget | null;
}) {
  const headingId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const [previews, setPreviews] = useState<DemoImportPreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const context: DemoImportContext = uploadTarget?.demoImportContext ?? {
    businessName: "Synthetic Cedar Workshop",
    applicationRevision: 0,
  };
  const contextKey = `${uploadTarget?.id ?? "generic"}:${context.businessName}:${context.applicationRevision}`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    // Clear application snapshots immediately when the permitted destination changes.
    void contextKey;
    sequence.current++;
    setPreviews([]);
    setError(null);
    setMessage(null);
    setBusy(false);
  }, [contextKey]);

  async function importFiles(files: File[]) {
    const token = ++sequence.current;
    setDragging(false);
    setPreviews([]);
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      if (files.length > demoImportMaxFiles)
        throw new Error(`Choose up to ${demoImportMaxFiles} text files at a time.`);
      if (files.some((file) => file.size > demoImportMaxBytes))
        throw new Error("Each Sample text file must be 64 KiB or smaller.");
      const inputs = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      const recipes = validateDemoTextImportBatch(inputs);
      if (!mounted.current || token !== sequence.current) return;
      setPreviews(
        recipes.map((recipe, index) => ({
          fixture: demoImportFixtureFor(recipe.id, context),
          source: {
            fileName: inputs[index]!.fileName,
            text: new TextDecoder().decode(inputs[index]!.bytes),
            context,
          },
        })),
      );
      setMessage(
        `${recipes.length} PDF preview${recipes.length === 1 ? "" : "s"} ready. Review the recipe before uploading.`,
      );
    } catch (failure) {
      if (mounted.current && token === sequence.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Unable to read these Sample text files. Try again.",
        );
    } finally {
      if (mounted.current && token === sequence.current) setBusy(false);
    }
  }

  return (
    <section aria-label="Sample text importer" className="space-y-3">
      <DemoStepHeading
        id={headingId}
        step={step}
        title="Import Sample text files"
        hint="A registered filename picks a PDF recipe; text content is ignored. Importing saves nothing until you upload the generated PDF."
      />
      <DemoDestination
        ready={Boolean(uploadTarget?.demoImportContext && uploadTarget.subject === "business")}
      >
        {uploadTarget?.demoImportContext && uploadTarget.subject === "business"
          ? `PDF destination: ${uploadTarget.label}. Scanning and analysis follow upload.`
          : "Open an authorized application document area or business task to generate uploadable samples. Generic downloads remain available."}
      </DemoDestination>
      <Collapsible className="group/recipes overflow-hidden rounded-lg border bg-card">
        <CollapsibleTrigger className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset w-full text-left">
          Supported text filenames and outcomes
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-open/recipes:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="divide-y border-t px-3 text-xs leading-5">
            {demoImportRecipes.map((recipe) => (
              <li key={recipe.id} className="py-2">
                <p className="font-medium break-all">{recipe.basename}</p>
                <p className="text-muted-foreground">
                  {workflowText(recipe.title)} ·{" "}
                  {recipe.outcome === "clear" ? "Matching sample" : "Needs review"}
                </p>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
      <section
        aria-label="Sample text import drop area"
        aria-busy={busy}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          void importFiles(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-3 py-4 text-center transition-colors",
          dragging ? "border-info bg-info/10" : "border-input",
        )}
      >
        <FileText aria-hidden="true" className="size-5 text-muted-foreground" />
        <p className="text-xs">Drop registered .txt files here</p>
        <input
          ref={picker}
          aria-label="Choose Sample text files"
          className="sr-only"
          tabIndex={-1}
          type="file"
          multiple
          accept=".txt,text/plain"
          onChange={(event) => {
            void importFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => picker.current?.click()}>
          Choose text files
        </Button>
        <p className="text-xs text-muted-foreground">
          UTF-8 text · 64 KiB per file · Up to 10 files
        </p>
      </section>
      {busy && (
        <p role="status" className="text-xs">
          Reading Sample text files…
        </p>
      )}
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {workflowText(error)} Open the supported filename list above.
        </p>
      )}
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
      {previews.map((preview, index) => {
        const { fixture } = preview;
        const recipe = demoImportRecipes.find((item) => item.id === fixture.recipeId);
        if (!recipe) return null;
        const canUpload =
          uploadTarget?.subject === "business" &&
          Boolean(uploadTarget.uploadImport) &&
          sameDemoImportContext(fixture, uploadTarget.demoImportContext);
        const financialFields = demoImportFields(fixture).filter((field) =>
          [
            "revenue",
            "ordinary_income",
            "adjusted_net_income",
            "opening_balance",
            "deposits",
            "withdrawals",
            "closing_balance",
          ].includes(field.key),
        );
        return (
          <article
            key={`${fixture.recipeId}:${index}`}
            aria-label={`Imported ${workflowText(recipe.title)}`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(demoImportMime, JSON.stringify(preview));
              event.dataTransfer.effectAllowed = "copy";
            }}
            className="group/import cursor-grab space-y-3 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/30 active:cursor-grabbing"
          >
            <div className="flex items-start gap-2">
              <GripVertical
                className="mt-1 size-4 shrink-0 text-muted-foreground group-hover/import:text-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 space-y-1">
                <p className="text-sm leading-6 font-medium">{workflowText(recipe.title)}</p>
                <p className="text-xs break-all text-muted-foreground">{recipe.fileName}</p>
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {workflowText(recipe.summary)}
            </p>
            <dl className="divide-y rounded-md border px-2.5 text-xs">
              {financialFields.map((field) => (
                <div key={field.key} className="flex justify-between gap-3 py-1.5">
                  <dt className="text-muted-foreground">
                    {field.provenance?.sourceLabel ?? field.label}
                  </dt>
                  <dd className="font-medium tabular-nums">USD {field.value}</dd>
                </div>
              ))}
              {recipe.outcome === "needs_review" && (
                <div className="flex justify-between gap-3 py-1.5">
                  <dt className="text-muted-foreground">Adjusted net income</dt>
                  <dd>Not supplied</dd>
                </div>
              )}
            </dl>
            <p className="text-xs text-muted-foreground">
              Period: {recipe.period.start}–{recipe.period.end}
            </p>
            <p className="text-xs break-words text-muted-foreground">
              {uploadTarget?.demoImportContext ? "Application snapshot" : "Generic business"}:{" "}
              {workflowName(fixture.businessName)}
            </p>
            <p className="text-xs break-words text-muted-foreground">
              PDF business: {demoImportBusinessName(fixture)}
            </p>
            <p className="text-xs">
              {recipe.outcome === "clear"
                ? "Expected result: name match to the printed snapshot"
                : "Needs review"}{" "}
              · Unverified
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                aria-label={`Upload imported ${workflowText(recipe.title)}`}
                disabled={!canUpload}
                onClick={() => {
                  uploadTarget?.uploadImport?.(preview);
                  setMessage(
                    `${workflowText(recipe.title)} sent to ${uploadTarget?.label ?? "the upload area"}.`,
                  );
                }}
              >
                <Upload aria-hidden="true" /> Upload
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label={`Download imported ${workflowText(recipe.title)}`}
                onClick={() => {
                  const url = URL.createObjectURL(createDemoImportFile(fixture));
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = recipe.fileName;
                  anchor.click();
                  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Download aria-hidden="true" /> Download
              </Button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
