import type { DemoImportContext } from "@keycade/contracts/demo-import";
import {
  type DemoDocument,
  demoDocumentBusinessName,
  demoScenarios,
} from "@keycade/contracts/demo-scenarios";
import { Button } from "@keycade/ui/components/button";
import { DemoBadge, DemoDestination, DemoStepHeading } from "@keycade/ui/components/demo-kit-parts";
import { DemoTextImporter } from "@keycade/ui/components/demo-text-importer";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { createDemoDocumentFile, demoDocumentMime } from "@keycade/ui/lib/demo-document-transfer";
import type { DemoImportPreview } from "@keycade/ui/lib/demo-import-transfer";
import { preferredDemoUploadTarget } from "@keycade/ui/lib/demo-upload-targets";
import { cn } from "cn";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FlaskConical,
  GripVertical,
  Info,
  PanelRightClose,
  PanelRightOpen,
  Upload,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export type DemoUploadTarget = {
  id: string;
  label: string;
  subject: DemoDocument["subject"];
  priority?: number;
  upload: (document: DemoDocument) => void;
  demoImportContext?: DemoImportContext;
  uploadImport?: (preview: DemoImportPreview) => void;
};
type DemoKitContextValue = {
  businessName: string;
  uploadsEnabled: boolean;
  uploadTarget: DemoUploadTarget | null;
  setUploadAvailability: (enabled: boolean) => void;
  registerUploadTarget: (target: DemoUploadTarget) => () => void;
  registerApplication: (id: string, name: string | null | undefined) => () => void;
};
const DemoKitContext = createContext<DemoKitContextValue | null>(null);
const selectionKey = "keycade.demo-scenario.v1";
/** Every kit surface uses the charcoal demo console palette (see `.demo-kit` in globals.css). */
const kitTheme = "dark demo-kit bg-background text-foreground";

export function useDemoKit() {
  return useContext(DemoKitContext);
}

export function useDemoApplication(id: string, name: string | null | undefined) {
  const register = useDemoKit()?.registerApplication;
  useEffect(() => register?.(id, name), [register, id, name]);
}

export function useDemoUploadAvailability(enabled: boolean) {
  const setAvailability = useDemoKit()?.setUploadAvailability;
  useEffect(() => {
    setAvailability?.(enabled);
    return () => setAvailability?.(true);
  }, [setAvailability, enabled]);
}

function initialScenario() {
  try {
    const id = localStorage.getItem(selectionKey);
    return demoScenarios.find((scenario) => scenario.id === id)?.id ?? "clear";
  } catch {
    return "clear";
  }
}

export function DemoKitProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState(initialScenario);
  const scenario = demoScenarios.find((item) => item.id === selected) ?? demoScenarios[0];
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [uploadsEnabled, setUploadAvailability] = useState(true);
  const [applications, setApplications] = useState<{ token: symbol; name: string | null }[]>([]);
  const [uploadTargets, setUploadTargets] = useState<(DemoUploadTarget & { token: symbol })[]>([]);
  const uploadTarget = preferredDemoUploadTarget(uploadTargets);
  const dialog = useRef<HTMLDialogElement>(null);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const registerApplication = useCallback((_id: string, name: string | null | undefined) => {
    const token = Symbol();
    setApplications((current) => [...current, { token, name: name?.trim() || null }]);
    return () => setApplications((current) => current.filter((entry) => entry.token !== token));
  }, []);
  const registerUploadTarget = useCallback((target: DemoUploadTarget) => {
    const token = Symbol();
    setUploadTargets((current) => [...current, { ...target, token }]);
    return () => setUploadTargets((current) => current.filter((entry) => entry.token !== token));
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const changed = () => {
      setDesktop(query.matches);
      setMobileOpen(false);
    };
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (mobileOpen && !desktop && !element.open) element.showModal();
    if ((!mobileOpen || desktop) && element.open) element.close();
  }, [mobileOpen, desktop]);
  const application = applications.at(-1);
  const businessName = application?.name ?? scenario.business.name;
  const context = useMemo(
    () => ({
      businessName,
      uploadsEnabled,
      uploadTarget: uploadsEnabled ? uploadTarget : null,
      setUploadAvailability,
      registerUploadTarget,
      registerApplication,
    }),
    [businessName, uploadsEnabled, uploadTarget, registerUploadTarget, registerApplication],
  );
  function select(id: string) {
    if (!demoScenarios.some((item) => item.id === id)) return;
    setSelected(id as typeof selected);
    try {
      localStorage.setItem(selectionKey, id);
    } catch {
      // Scenario selection still works when browser storage is unavailable.
    }
  }
  function closeMobile() {
    setMobileOpen(false);
    mobileToggle.current?.focus();
  }
  const panel = (
    <DemoKitPanel
      scenario={scenario}
      select={select}
      businessName={businessName}
      applicationSelected={Boolean(application?.name)}
      uploadTarget={uploadsEnabled ? uploadTarget : null}
      close={() => (desktop ? setExpanded(false) : closeMobile())}
    />
  );
  return (
    <DemoKitContext.Provider value={context}>
      <div style={{ paddingRight: desktop ? (expanded ? 340 : 56) : 0 }}>
        {!desktop && (
          <div
            className={cn(
              kitTheme,
              "flex items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-5",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <DemoBadge />
              <span className="truncate text-xs text-muted-foreground max-sm:hidden">
                Fictional data only
              </span>
            </span>
            <Button
              ref={mobileToggle}
              size="sm"
              variant="outline"
              aria-expanded={mobileOpen}
              aria-haspopup="dialog"
              onClick={() => setMobileOpen(true)}
            >
              <PanelRightOpen aria-hidden="true" /> Show demo kit
            </Button>
          </div>
        )}
        {children}
      </div>
      {desktop ? (
        expanded ? (
          <aside
            aria-label="Demo scenario kit"
            className={cn(
              kitTheme,
              "fixed inset-y-0 right-0 z-20 w-[340px] overflow-y-auto overscroll-contain border-l",
            )}
          >
            {panel}
          </aside>
        ) : (
          <div
            className={cn(
              kitTheme,
              "fixed inset-y-0 right-0 z-20 flex w-14 flex-col items-center border-l py-3",
            )}
          >
            <Button
              variant="ghost"
              aria-label="Show demo kit"
              aria-expanded={false}
              onClick={() => setExpanded(true)}
              className="h-auto flex-col gap-3 px-2 py-3 text-muted-foreground"
            >
              <PanelRightOpen aria-hidden="true" />
              <span
                aria-hidden="true"
                className="flex size-6 items-center justify-center rounded-full bg-demo-accent text-demo-accent-foreground"
              >
                <FlaskConical className="size-3.5" />
              </span>
              <span aria-hidden="true" className="text-xs font-semibold [writing-mode:vertical-rl]">
                Demo kit
              </span>
            </Button>
          </div>
        )
      ) : (
        <dialog
          ref={dialog}
          aria-label="Demo scenario kit"
          onCancel={closeMobile}
          onClose={closeMobile}
          className={cn(
            kitTheme,
            "fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(100%,380px)] max-w-none overflow-y-auto overscroll-contain border-l p-0 backdrop:bg-black/50",
          )}
        >
          {panel}
        </dialog>
      )}
    </DemoKitContext.Provider>
  );
}

/** Short, scannable name for what each sample PDF demonstrates once processed. */
const outcomeTags: Record<DemoDocument["outcome"], { label: string; tone: string }> = {
  clear: { label: "No issues expected", tone: "bg-success" },
  name_mismatch: { label: "Name mismatch", tone: "bg-warning" },
  cash_flow: { label: "Cash-flow flag", tone: "bg-warning" },
  low_confidence: { label: "Low confidence", tone: "bg-warning" },
  scan_blocked: { label: "Quarantined", tone: "bg-danger" },
  processing_transient: { label: "Retries, then succeeds", tone: "bg-info" },
  processing_error: { label: "Interpretation fails", tone: "bg-danger" },
  unknown: { label: "Unclassified", tone: "bg-muted-foreground" },
};

function KitTag({ tone, children }: { tone?: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
      {tone && <span aria-hidden="true" className={cn("size-1.5 rounded-full", tone)} />}
      {children}
    </span>
  );
}

function KitDisclosure({
  title,
  meta,
  className,
  children,
}: {
  title: string;
  meta?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={cn("group/kit-disclosure", className)}>
      <summary className="disclosure flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        {title}
        <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
          {meta}
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-open/kit-disclosure:rotate-180"
          />
        </span>
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
}

function CopyValue({
  label,
  value,
  name = label,
}: {
  label: string;
  value: string;
  /** Distinguishes repeated labels, such as each person's email, in the copy button's name. */
  name?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = window.setTimeout(() => setState("idle"), 1500);
    return () => window.clearTimeout(timer);
  }, [state]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="col-start-1 text-sm break-words">
        {value}
        <span
          role="status"
          className={state === "failed" ? "block text-xs text-warning" : "sr-only"}
        >
          {state === "copied" ? "Copied." : state === "failed" ? "Select and copy this value." : ""}
        </span>
      </dd>
      <dd className="col-start-2 row-span-2 row-start-1">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Copy ${name}`}
          className="text-muted-foreground"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setState("copied");
            } catch {
              setState("failed");
            }
          }}
        >
          {state === "copied" ? (
            <Check aria-hidden="true" className="text-success" />
          ) : (
            <Copy aria-hidden="true" />
          )}
        </Button>
      </dd>
    </div>
  );
}

function PersonValues({
  role,
  person,
  children,
}: {
  role: string;
  person: { name: string; email: string };
  children?: ReactNode;
}) {
  const lower = role.toLowerCase();
  return (
    <div className="rounded-md border px-3 pt-2.5">
      <h4 className="text-xs font-semibold">{role}</h4>
      <dl className="divide-y">
        <CopyValue label="Name" name={`${lower} name`} value={person.name} />
        <CopyValue label="Email" name={`${lower} email`} value={person.email} />
        {children}
      </dl>
    </div>
  );
}

function DemoKitPanel({
  scenario,
  select,
  businessName,
  applicationSelected,
  uploadTarget,
  close,
}: {
  scenario: (typeof demoScenarios)[number];
  select: (id: string) => void;
  businessName: string;
  applicationSelected: boolean;
  uploadTarget: DemoUploadTarget | null;
  close: () => void;
}) {
  const id = useId();
  const [message, setMessage] = useState("");
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-background/95 px-4 py-4 backdrop-blur-sm">
        <div className="min-w-0">
          <DemoBadge />
          <h2 className="mt-2 text-lg leading-6 font-semibold">Demo kit</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Fictional people and sample PDFs for presenting Keycade.
          </p>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Hide demo kit" onClick={close}>
          <PanelRightClose aria-hidden="true" />
        </Button>
      </header>
      <div className="flex-1 space-y-8 px-4 py-5">
        <section aria-labelledby={`${id}-scenario`} className="space-y-3">
          <DemoStepHeading id={`${id}-scenario`} step={1} title="Choose a scenario" />
          <label htmlFor={`${id}-select`} className="sr-only">
            Demo scenario
          </label>
          <NativeSelect
            id={`${id}-select`}
            value={scenario.id}
            className="w-full"
            onChange={(event) => select(event.target.value)}
          >
            {demoScenarios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs leading-5 text-muted-foreground">{scenario.description}</p>
          <KitDisclosure
            title="Walk through the app"
            meta={`${scenario.steps.length} steps`}
            className="overflow-hidden rounded-lg border bg-card"
          >
            <ol className="space-y-3 pt-1">
              {scenario.steps.map((step, index) => (
                <li key={step} className="flex gap-2.5 text-xs leading-5">
                  <span
                    aria-hidden="true"
                    className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-medium tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>
          </KitDisclosure>
        </section>

        <section aria-labelledby={`${id}-details`} className="space-y-3">
          <DemoStepHeading
            id={`${id}-details`}
            step={2}
            title="Copy details into forms"
            hint="Paste these into the borrower sign-in and setup questions."
          />
          <div className="overflow-hidden rounded-lg border bg-card">
            <dl className="divide-y px-3">
              <CopyValue label="Business name" value={businessName} />
              <CopyValue label="Client email" value={scenario.client.email} />
            </dl>
            <KitDisclosure title="Business setup details" className="border-t">
              <dl className="divide-y">
                <CopyValue label="Synthetic EIN" value={scenario.business.ein} />
                <CopyValue label="Industry code" value={scenario.business.industryCode} />
                <CopyValue label="Requested amount" value={scenario.business.requestedAmount} />
                <CopyValue label="Loan purpose" value={scenario.business.purpose} />
              </dl>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                In the secure EIN task, choose 000000001 for the formatted sample value.
              </p>
            </KitDisclosure>
            <KitDisclosure
              title="Client and collaborators"
              meta={`${scenario.guarantors.length + 2} people`}
              className="border-t"
            >
              <div className="space-y-3">
                <PersonValues role="Client" person={scenario.client} />
                {scenario.guarantors.map((person, index) => (
                  <PersonValues key={person.email} role={`Guarantor ${index + 1}`} person={person}>
                    <CopyValue
                      label="Ownership"
                      name={`guarantor ${index + 1} ownership`}
                      value={`${person.ownershipPercent}%`}
                    />
                    <CopyValue
                      label="Synthetic SSN"
                      name={`guarantor ${index + 1} synthetic SSN`}
                      value={person.ssn}
                    />
                  </PersonValues>
                ))}
                <PersonValues role="Adviser" person={scenario.adviser} />
                <p className="text-xs leading-5 text-muted-foreground">
                  These are sample identities. Ownership and portal permissions are separate; add
                  people and assign access through the application. In secure SSN tasks, choose
                  000000001 for the formatted sample value.
                </p>
              </div>
            </KitDisclosure>
          </div>
        </section>

        <section aria-labelledby={`${id}-documents`} className="space-y-3">
          <DemoStepHeading
            id={`${id}-documents`}
            step={3}
            title="Add sample PDFs"
            hint="Drag a card onto an upload area, or press Upload."
          />
          <DemoDestination ready={Boolean(uploadTarget)}>
            {uploadTarget
              ? `Upload destination: ${uploadTarget.label}.`
              : "Open Documents or an uploadable task to enable Upload."}
          </DemoDestination>
          {applicationSelected && (
            <p className="text-xs leading-5 text-muted-foreground">
              PDFs use this application’s saved business name. The review scenario deliberately
              includes a different name on one document.
            </p>
          )}
          {message && (
            <p role="status" className="text-xs">
              {message}
            </p>
          )}
          {scenario.documents.map((document) => {
            const tag = outcomeTags[document.outcome];
            const pdfBusiness = demoDocumentBusinessName(document, businessName);
            return (
              <article
                key={document.id}
                aria-label={document.title}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(
                    demoDocumentMime,
                    JSON.stringify({ id: document.id, businessName }),
                  );
                }}
                className="group/document cursor-grab space-y-3 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/30 active:cursor-grabbing"
              >
                <div className="flex items-start gap-2">
                  <GripVertical
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-muted-foreground group-hover/document:text-foreground"
                  />
                  <div className="min-w-0 space-y-1">
                    <h4 className="text-sm leading-6 font-medium">{document.title}</h4>
                    <p className="text-xs break-all text-muted-foreground">{document.fileName}</p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <KitTag tone={tag.tone}>
                        <span className="sr-only">Expected result: </span>
                        {tag.label}
                      </KitTag>
                      {document.subject === "guarantor" && <KitTag>Private guarantor task</KitTag>}
                    </div>
                  </div>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{document.summary}</p>
                {pdfBusiness !== businessName && (
                  <p className="text-xs leading-5">
                    PDF business: <span className="font-medium">{pdfBusiness}</span>
                  </p>
                )}
                {document.subject === "guarantor" && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    Sample identity: {scenario.guarantors[0]?.name}. Verify the intended private
                    task; this PDF does not change its fictional person to match the task owner.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    aria-label={`Upload ${document.title}`}
                    disabled={!uploadTarget || uploadTarget.subject !== document.subject}
                    onClick={() => {
                      uploadTarget?.upload(document);
                      setMessage(`${document.title} sent to the upload area.`);
                    }}
                  >
                    <Upload aria-hidden="true" /> Upload
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Download ${document.title}`}
                    onClick={() => {
                      const file = createDemoDocumentFile(document, businessName);
                      const url = URL.createObjectURL(file);
                      const anchor = window.document.createElement("a");
                      anchor.href = url;
                      anchor.download = document.fileName;
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

        <DemoTextImporter step={4} uploadTarget={uploadTarget} />
      </div>
      <footer className="flex items-start gap-2 border-t px-4 py-4 text-xs leading-5 text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p>
          Checks and document suggestions are simulated. Bank staff make the demo review decision.
          Signatures and funding are simulated.
        </p>
      </footer>
    </div>
  );
}
