import { Button } from "@keycade/ui/components/button";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { useEffect, useState } from "react";

export type SecureTaskInputData = {
  revision: number;
  identifierPresent: boolean;
  identifierMasked: string | null;
  taxAuthorized: boolean;
  noticeVersion: string;
  notice: string;
  canEdit: boolean;
};
export type TaskInputKind =
  | "answer"
  | "signature"
  | "synthetic_business_identifier"
  | "synthetic_personal_identifier"
  | "tax_authorization";

export function SecureTaskInput({
  taskId,
  kind,
  data,
  disabled,
  onDirtyChange,
  save,
}: {
  taskId: string;
  kind: Exclude<TaskInputKind, "answer" | "signature">;
  data: SecureTaskInputData | null;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  save: (
    action: "identifier" | "tax-authorization",
    body: object,
    message: string,
  ) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [authorized, setAuthorized] = useState(data?.taxAuthorized ?? false);
  const [authorizationEdited, setAuthorizationEdited] = useState(false);
  const authorization = kind === "tax_authorization";
  const dirty = authorization ? authorized !== Boolean(data?.taxAuthorized) : value !== "";
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!authorizationEdited) setAuthorized(data?.taxAuthorized ?? false);
  }, [authorizationEdited, data?.taxAuthorized]);
  if (!data)
    return (
      <p className="text-sm text-muted-foreground">
        Private input is unavailable. Reload the saved task to check access.
      </p>
    );
  const locked = disabled || !data.canEdit;
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (authorization) {
          if (
            await save(
              "tax-authorization",
              {
                expectedInputRevision: data.revision,
                authorized,
                noticeVersion: data.noticeVersion,
              },
              "Synthetic tax authorization saved.",
            )
          )
            setAuthorizationEdited(false);
        } else if (
          await save(
            "identifier",
            { expectedInputRevision: data.revision, value },
            "Synthetic identifier saved privately. Only its masked value is displayed.",
          )
        )
          setValue("");
      }}
    >
      <p className="text-sm font-medium">
        {authorization
          ? "Synthetic tax authorization"
          : kind === "synthetic_business_identifier"
            ? "Synthetic business identifier"
            : "Synthetic personal identifier"}
      </p>
      {authorization ? (
        <>
          <p className="text-sm text-muted-foreground" id={`tax-notice-${taskId}`}>
            {data.notice}
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              aria-label="Authorize simulated tax records"
              aria-describedby={`tax-notice-${taskId}`}
              checked={authorized}
              disabled={locked}
              onChange={(event) => {
                setAuthorized(event.target.checked);
                setAuthorizationEdited(true);
              }}
            />
            Authorize simulated tax records
          </label>
          <p className="text-xs text-muted-foreground">
            Current authorization:{" "}
            {data.taxAuthorized ? "Granted for this demonstration" : "Not granted"}.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Saved value:{" "}
            <span className="font-medium text-foreground">
              {data.identifierPresent
                ? (data.identifierMasked ?? "Saved privately")
                : "Not provided"}
            </span>
          </p>
          {data.canEdit && (
            <div className="space-y-2">
              <label htmlFor={`synthetic-identifier-${taskId}`} className="text-sm">
                Choose a synthetic {kind === "synthetic_business_identifier" ? "EIN" : "SSN"}
              </label>
              <NativeSelect
                id={`synthetic-identifier-${taskId}`}
                className="w-full"
                value={value}
                disabled={locked}
                required
                onChange={(event) => setValue(event.target.value)}
              >
                <option value="">Choose a demo value</option>
                {Array.from({ length: 7 }, (_, index) => `00000000${index + 1}`).map((fixture) => (
                  <option value={fixture} key={fixture}>
                    {fixture}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Only these registered fictional values are accepted. Never enter a real EIN or SSN.
            Saving a demo identifier does not verify identity or approve the application.
          </p>
        </>
      )}
      {data.canEdit ? (
        <Button type="submit" variant="outline" disabled={locked || !dirty}>
          {authorization ? "Save tax authorization" : "Save synthetic identifier"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only an authorized participant can update this private input.
        </p>
      )}
    </form>
  );
}
