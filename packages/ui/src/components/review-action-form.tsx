import { Button } from "@keycade/ui/components/button";
import { Input } from "@keycade/ui/components/input";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { workflowText } from "@keycade/ui/lib/workflow-text";
import { useEffect, useState } from "react";

export type ReviewAction =
  | "submit"
  | "start-review"
  | "request-information"
  | "approve"
  | "decline"
  | "withdraw";
export type ReviewActionInput = {
  reasonCode?: string;
  privateNote?: string;
  approvedAmount?: string;
  taskIds?: string[];
  confirmed: boolean;
};
const actionTitles: Record<Exclude<ReviewAction, "start-review">, string> = {
  submit: "Confirm submission",
  "request-information": "Request more information",
  approve: "Record an approval",
  decline: "Record a decline",
  withdraw: "Withdraw this application",
};
const buttonLabels: Record<Exclude<ReviewAction, "start-review">, string> = {
  submit: "Submit application",
  "request-information": "Send information request",
  approve: "Record approval",
  decline: "Record decline",
  withdraw: "Withdraw application",
};

export function ReviewActionForm({
  action,
  canManage,
  requestedAmount,
  reasonOptions,
  requestableTasks,
  busy,
  stale,
  onDirtyChange,
  save,
  cancel,
}: {
  action: Exclude<ReviewAction, "start-review">;
  canManage: boolean;
  requestedAmount: string | null;
  reasonOptions: { value: string; label: string }[];
  requestableTasks: { id: string; title: string }[];
  busy: boolean;
  stale: boolean;
  onDirtyChange: (dirty: boolean) => void;
  save: (input: ReviewActionInput) => Promise<void>;
  cancel: () => void;
}) {
  const [reasonCode, setReasonCode] = useState("");
  const [privateNote, setPrivateNote] = useState("");
  const [approvedAmount, setApprovedAmount] = useState(requestedAmount ?? "");
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const dirty =
    reasonCode !== "" ||
    privateNote !== "" ||
    approvedAmount !== (requestedAmount ?? "") ||
    taskIds.length > 0 ||
    confirmed;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const locked = busy || stale;
  const requiresTasks = action === "request-information";
  const decision = action === "approve" || action === "decline";
  const hasPrivateNote =
    canManage && ["request-information", "approve", "decline", "withdraw"].includes(action);
  return (
    <form
      aria-label={actionTitles[action]}
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        let amount = approvedAmount.trim();
        if (action === "approve") {
          if (
            !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(amount) ||
            /^0(?:\.0{1,2})?$/.test(amount)
          ) {
            setAmountError("Enter a positive amount with no more than two decimal places.");
            return;
          }
          const [whole, fraction = ""] = amount.split(".");
          amount = `${whole}.${fraction.padEnd(2, "0")}`;
        }
        setAmountError(null);
        await save({
          ...(reasonOptions.length ? { reasonCode } : {}),
          ...(hasPrivateNote && privateNote.trim() ? { privateNote: privateNote.trim() } : {}),
          ...(action === "approve" ? { approvedAmount: amount } : {}),
          ...(requiresTasks ? { taskIds } : {}),
          confirmed,
        });
      }}
    >
      <div className="space-y-2">
        <h3 className="font-semibold tracking-tight">{actionTitles[action]}</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          {action === "submit"
            ? canManage
              ? "You are submitting on the applicant’s behalf. The current application and evidence references will be saved as a new submission."
              : "The current application and evidence references will be saved for the bank’s review. Material information becomes locked until the bank requests changes."
            : action === "request-information"
              ? "Select the tasks that need an update. The applicant can edit again and send a fresh submission; previous submissions stay in the history."
              : action === "approve"
                ? "Record the approved amount for this submission. Closing and recorded funding are separate steps."
                : action === "decline"
                  ? "Declining closes this application. A new request requires a new application."
                  : "Withdrawal closes this application and stops pending work that no longer applies. Saved history remains available."}
        </p>
      </div>
      {reasonOptions.length > 0 && (
        <div className="space-y-2">
          <label htmlFor="review-public-reason" className="text-sm font-medium">
            {canManage ? "Reason shared with the applicant" : "Withdrawal reason"}
          </label>
          <NativeSelect
            className="w-full"
            id="review-public-reason"
            value={reasonCode}
            required
            disabled={locked}
            onChange={(event) => setReasonCode(event.target.value)}
          >
            <option value="">Choose a reason</option>
            {reasonOptions.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {workflowText(reason.label)}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {requiresTasks && (
        <fieldset className="space-y-3" disabled={locked}>
          <legend className="mb-2 text-sm font-medium">Tasks requiring an update</legend>
          {requestableTasks.map((task) => (
            <label key={task.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={taskIds.includes(task.id)}
                onChange={(event) =>
                  setTaskIds(
                    event.target.checked
                      ? [...taskIds, task.id]
                      : taskIds.filter((id) => id !== task.id),
                  )
                }
              />
              {workflowText(task.title)}
            </label>
          ))}
          {requestableTasks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No returnable tasks are available. Add a relevant request in Tasks before returning
              the application.
            </p>
          )}
        </fieldset>
      )}
      {action === "approve" && (
        <div className="space-y-2">
          <label htmlFor="approved-amount" className="text-sm font-medium">
            Approved amount (USD)
          </label>
          <Input
            id="approved-amount"
            inputMode="decimal"
            value={approvedAmount}
            disabled={locked}
            required
            aria-invalid={Boolean(amountError)}
            aria-describedby={amountError ? "approved-amount-error" : undefined}
            onChange={(event) => {
              setApprovedAmount(event.target.value);
              setAmountError(null);
            }}
          />
          {amountError && (
            <p id="approved-amount-error" role="alert" className="text-sm text-destructive">
              {amountError}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            The amount must stay within this product’s limits and the submitted requested amount.
            Repayment and servicing terms are outside this release.
          </p>
        </div>
      )}
      {hasPrivateNote && (
        <div className="space-y-2">
          <label htmlFor="review-private-note" className="text-sm font-medium">
            Private staff note (optional)
          </label>
          <textarea
            id="review-private-note"
            className="min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            maxLength={2000}
            value={privateNote}
            disabled={locked}
            onChange={(event) => setPrivateNote(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Visible only to authorized bank staff. Use information.
          </p>
        </div>
      )}
      <label className="flex items-start gap-2 text-sm leading-6">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirmed}
          disabled={locked}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {decision
          ? "I reviewed the current application and am deliberately recording this decision."
          : action === "submit"
            ? "I confirm this application is ready for bank review."
            : action === "request-information"
              ? "I confirm these tasks need an update from the applicant."
              : "I understand this application will be closed and cannot be reopened."}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          loading={busy}
          type="submit"
          disabled={
            locked ||
            !confirmed ||
            (reasonOptions.length > 0 && !reasonCode) ||
            (requiresTasks && taskIds.length === 0)
          }
        >
          {buttonLabels[action]}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={cancel}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Review all details before continuing.</p>
    </form>
  );
}
