import {
  type DemoDocument,
  demoDocumentBusinessName,
  demoScenarios,
} from "@keycade/contracts/demo-scenarios";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { createDemoDocumentFile, demoDocumentMime } from "@keycade/ui/lib/demo-document-transfer";
import { preferredDemoUploadTarget } from "@keycade/ui/lib/demo-upload-targets";
import {
  Copy,
  Download,
  GripVertical,
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
          <div className="flex items-center justify-between gap-3 border-b border-indigo-200 bg-indigo-50 px-5 py-3 text-indigo-950">
            <span className="text-xs font-medium">Fictional demo kit</span>
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
            className="fixed inset-y-0 right-0 z-20 w-[340px] overflow-y-auto border-l border-indigo-200 bg-indigo-50 text-indigo-950"
          >
            {panel}
          </aside>
        ) : (
          <div className="fixed inset-y-0 right-0 z-20 w-14 border-l border-indigo-200 bg-indigo-50 p-2 text-indigo-950">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Show demo kit"
              aria-expanded={false}
              onClick={() => setExpanded(true)}
            >
              <PanelRightOpen aria-hidden="true" />
            </Button>
          </div>
        )
      ) : (
        <dialog
          ref={dialog}
          aria-label="Demo scenario kit"
          onCancel={closeMobile}
          onClose={closeMobile}
          className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(100%,380px)] max-w-none overflow-y-auto border-l border-indigo-200 bg-indigo-50 p-0 text-indigo-950 backdrop:bg-black/30"
        >
          {panel}
        </dialog>
      )}
    </DemoKitContext.Provider>
  );
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [message, setMessage] = useState("");
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <dt className="text-xs text-indigo-800">{label}</dt>
        <dd className="mt-0.5 break-words text-sm">{value}</dd>
        {message && (
          <p role="status" className="text-xs">
            {message}
          </p>
        )}
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setMessage("Copied.");
          } catch {
            setMessage("Select and copy this value.");
          }
        }}
      >
        <Copy aria-hidden="true" />
      </Button>
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
  const selectId = useId();
  const [message, setMessage] = useState("");
  return (
    <div className="space-y-6 p-5">
      <div className="sticky -top-5 z-10 -mx-5 flex items-start justify-between gap-3 border-b border-indigo-200 bg-indigo-50 px-5 py-4">
        <div>
          <Badge variant="outline" className="border-indigo-200 text-indigo-900">
            Demo only
          </Badge>
          <h2 className="mt-2 text-lg font-semibold">Scenario kit</h2>
          <p className="mt-1 text-xs leading-5 text-indigo-800">
            Fictional people and PDFs for demonstrating the app.
          </p>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Hide demo kit" onClick={close}>
          <PanelRightClose aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-2">
        <label htmlFor={selectId} className="text-sm font-medium">
          Demo scenario
        </label>
        <NativeSelect
          id={selectId}
          value={scenario.id}
          className="w-full bg-white/70"
          onChange={(event) => select(event.target.value)}
        >
          {demoScenarios.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs leading-5 text-indigo-800">{scenario.description}</p>
      </div>
      <section aria-label="Demo business" className="space-y-3">
        <dl>
          <CopyValue label="Business name" value={businessName} />
        </dl>
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium">Business setup details</summary>
          <dl className="mt-3 space-y-3">
            <CopyValue label="Synthetic EIN" value={scenario.business.ein} />
            <CopyValue label="Industry code" value={scenario.business.industryCode} />
            <CopyValue label="Requested amount" value={scenario.business.requestedAmount} />
            <CopyValue label="Loan purpose" value={scenario.business.purpose} />
          </dl>
          {applicationSelected && (
            <p className="mt-3 text-xs leading-5 text-indigo-800">
              PDFs use this application’s saved business name. The review scenario deliberately
              includes a different name on one document.
            </p>
          )}
        </details>
      </section>
      <section aria-label="Demo people" className="space-y-3">
        <p className="text-xs leading-5 text-indigo-800">
          Client: {scenario.client.name} · {scenario.guarantors.length} sample guarantor
          {scenario.guarantors.length === 1 ? "" : "s"} · {scenario.adviser.name} advises.
        </p>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Client and collaborators</summary>
          <dl className="mt-3 space-y-3">
            <CopyValue label="Client name" value={scenario.client.name} />
            <CopyValue label="Client email" value={scenario.client.email} />
            <CopyValue label="Adviser name" value={scenario.adviser.name} />
            <CopyValue label="Adviser email" value={scenario.adviser.email} />
            {scenario.guarantors.map((person, index) => (
              <div key={person.email} className="space-y-3 rounded-lg border border-indigo-200 p-3">
                <CopyValue label={`Guarantor ${index + 1} name`} value={person.name} />
                <CopyValue label={`Guarantor ${index + 1} email`} value={person.email} />
                <CopyValue
                  label={`Guarantor ${index + 1} ownership`}
                  value={`${person.ownershipPercent}%`}
                />
                <CopyValue label={`Guarantor ${index + 1} synthetic SSN`} value={person.ssn} />
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-5 text-indigo-800">
            These are sample identities. Ownership and portal permissions are separate; add people
            and assign access through the application. In secure EIN and SSN tasks, choose 000000001
            for the formatted sample values above.
          </p>
        </details>
      </section>
      <section aria-label="Demo documents" className="space-y-3">
        <h3 className="text-sm font-semibold">Drag a PDF into the upload area</h3>
        <p className="text-xs leading-5 text-indigo-800">
          Download saves a sample PDF. Upload uses the open, authorized document area. For personal
          evidence, open the guarantor’s private task.
        </p>
        <p className="text-xs leading-5 text-indigo-800">
          {uploadTarget
            ? `Upload destination: ${uploadTarget.label}.`
            : "Open Documents or an uploadable task to enable Upload."}
        </p>
        {message && (
          <p role="status" className="text-xs">
            {message}
          </p>
        )}
        {scenario.documents.map((document) => (
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
            className="space-y-3 rounded-lg border border-indigo-200 bg-white/75 p-3"
          >
            <div className="flex items-start gap-2">
              <GripVertical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-indigo-700" />
              <div className="min-w-0">
                <h4 className="text-sm font-medium">{document.title}</h4>
                <p className="mt-1 break-all text-xs text-indigo-800">{document.fileName}</p>
              </div>
            </div>
            <p className="text-xs leading-5">
              <span className="font-medium">Expected: </span>
              {document.summary}
            </p>
            <p className="text-xs text-indigo-800">
              PDF business: {demoDocumentBusinessName(document, businessName)}
            </p>
            {document.subject === "guarantor" && (
              <p className="text-xs leading-5 text-indigo-800">
                Sample identity: {scenario.guarantors[0]?.name}. Verify the intended private task;
                this PDF does not change its fictional person to match the task owner.
              </p>
            )}
            <div className="flex gap-2">
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
              <Button
                size="sm"
                variant="outline"
                aria-label={`Upload ${document.title}`}
                disabled={!uploadTarget || uploadTarget.subject !== document.subject}
                onClick={() => {
                  uploadTarget?.upload(document);
                  setMessage(`${document.title} sent to the upload area.`);
                }}
              >
                <Upload aria-hidden="true" /> Upload
              </Button>
            </div>
          </article>
        ))}
      </section>
      <section aria-label="Demo walkthrough" className="space-y-3">
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Walk through the app</summary>
          <ol className="mt-3 list-decimal space-y-3 pl-4 text-xs leading-5 text-indigo-800">
            {scenario.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
        <p className="text-xs leading-5 text-indigo-800">
          Checks and document suggestions are simulated. Bank staff make the demo review decision.
          Signatures and funding are simulated.
        </p>
      </section>
    </div>
  );
}
