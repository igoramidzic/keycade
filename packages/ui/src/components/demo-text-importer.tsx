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
import type { DemoUploadTarget } from "@keycade/ui/components/demo-kit";
import {
  createDemoImportFile,
  type DemoImportPreview,
  demoImportMime,
  sameDemoImportContext,
} from "@keycade/ui/lib/demo-import-transfer";
import { Download, GripVertical, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function DemoTextImporter({ uploadTarget }: { uploadTarget: DemoUploadTarget | null }) {
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
        throw new Error("Each demo text file must be 64 KiB or smaller.");
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
        `${recipes.length} synthetic PDF preview${recipes.length === 1 ? "" : "s"} ready. Review the recipe before uploading.`,
      );
    } catch (failure) {
      if (mounted.current && token === sequence.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Unable to read these demo text files. Try again.",
        );
    } finally {
      if (mounted.current && token === sequence.current) setBusy(false);
    }
  }

  return (
    <section aria-label="Demo text importer" className="space-y-3">
      <h3 className="text-sm font-semibold">Import demo text files</h3>
      <p className="text-xs leading-5 text-indigo-800">
        A registered filename chooses a synthetic PDF recipe. Text content is ignored. Review,
        download or upload the generated PDF; importing alone does not save a document.
      </p>
      <details>
        <summary className="cursor-pointer text-xs font-medium">
          Supported text filenames and outcomes
        </summary>
        <ul className="mt-2 space-y-3 text-xs leading-5">
          {demoImportRecipes.map((recipe) => (
            <li key={recipe.id}>
              <p className="break-all font-medium">{recipe.basename}</p>
              <p>
                {recipe.title} ·{" "}
                {recipe.outcome === "clear" ? "Simulated matching sample" : "Needs review"}
              </p>
            </li>
          ))}
        </ul>
      </details>
      <section
        aria-label="Demo text import drop area"
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
        className={`rounded-lg border-2 border-dashed p-3 ${dragging ? "border-indigo-700 bg-white" : "border-indigo-200"}`}
      >
        <p className="mb-2 text-xs">Drop registered .txt files here</p>
        <input
          ref={picker}
          aria-label="Choose demo text files"
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
        <p className="mt-2 text-xs">UTF-8 text · 64 KiB per file · Up to 10 files</p>
      </section>
      {busy && (
        <p role="status" className="text-xs">
          Reading demo text files…
        </p>
      )}
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error} Open the supported filename list above.
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
            aria-label={`Imported ${recipe.title}`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(demoImportMime, JSON.stringify(preview));
              event.dataTransfer.effectAllowed = "copy";
            }}
            className="space-y-2 rounded-lg border border-indigo-200 bg-white/70 p-3"
          >
            <div className="flex items-start gap-2">
              <GripVertical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p className="text-sm font-medium">{recipe.title}</p>
            </div>
            <p className="break-all text-xs">{recipe.fileName}</p>
            <p className="text-xs">{recipe.summary}</p>
            <dl className="space-y-1 text-xs">
              {financialFields.map((field) => (
                <div key={field.key}>
                  <dt>{field.provenance?.sourceLabel ?? field.label}</dt>
                  <dd className="font-medium">USD {field.value}</dd>
                </div>
              ))}
              {recipe.outcome === "needs_review" && (
                <div>
                  <dt>Adjusted net income</dt>
                  <dd>Not supplied</dd>
                </div>
              )}
            </dl>
            <p className="text-xs">
              Period: {recipe.period.start}–{recipe.period.end}
            </p>
            <p className="break-words text-xs">
              {uploadTarget?.demoImportContext
                ? "Application snapshot"
                : "Generic synthetic business"}
              : {fixture.businessName}
            </p>
            <p className="break-words text-xs">PDF business: {demoImportBusinessName(fixture)}</p>
            <p className="text-xs">
              {recipe.outcome === "clear"
                ? "Expected result: simulated name match to the printed snapshot"
                : "Needs review"}{" "}
              · Synthetic, unverified
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                aria-label={`Download imported ${recipe.title}`}
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
              <Button
                size="sm"
                variant="outline"
                aria-label={`Upload imported ${recipe.title}`}
                disabled={!canUpload}
                onClick={() => {
                  uploadTarget?.uploadImport?.(preview);
                  setMessage(
                    `${recipe.title} sent to ${uploadTarget?.label ?? "the upload area"}.`,
                  );
                }}
              >
                <Upload aria-hidden="true" /> Upload
              </Button>
            </div>
          </article>
        );
      })}
      <p className="text-xs leading-5 text-indigo-800">
        {uploadTarget?.demoImportContext && uploadTarget.subject === "business"
          ? `PDF destination: ${uploadTarget.label}. Scanning and simulated analysis follow upload.`
          : "Open an authorized application document area or business task to generate uploadable samples. Generic downloads remain available."}
      </p>
    </section>
  );
}
