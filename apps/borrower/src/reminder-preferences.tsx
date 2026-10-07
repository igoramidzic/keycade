import { notificationPreferenceSchema } from "@keycade/contracts";
import { Button } from "@keycade/ui/components/button";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "./api";
import { ErrorNotice } from "./workspace-ui";

export function ReminderPreferences({ session }: { session: AuthenticatedSession }) {
  const client = useQueryClient();
  const queryKey = ["notification-preferences", session.bank.id, session.user.email];
  const base = `/api/v1/banks/${session.bank.id}/notification-preferences`;
  const options = { bankId: session.bank.id, actorEmail: session.user.email };
  const preferences = useQuery({
    queryKey,
    queryFn: ({ signal }) => request(base, notificationPreferenceSchema, { ...options, signal }),
    retry: false,
    refetchOnMount: "always",
  });
  const [draft, setDraft] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <details className="max-w-sm text-sm">
      <summary className="cursor-pointer text-muted-foreground">Reminder settings</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs leading-5 text-muted-foreground">
          Optional demo reminders for unfinished applications. Sign-in links and requested
          invitations are separate.
        </p>
        {preferences.error && (
          <ErrorNotice error={preferences.error} onRetry={() => void preferences.refetch()} />
        )}
        {Boolean(error) && <ErrorNotice error={error} />}
        {preferences.data && !preferences.error && (
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              setSaved(false);
              try {
                const updated = await request(base, notificationPreferenceSchema, {
                  ...options,
                  method: "POST",
                  body: { remindersEnabled: draft ?? preferences.data.remindersEnabled },
                });
                client.setQueryData(queryKey, updated);
                setDraft(null);
                setSaved(true);
              } catch (failure) {
                setError(failure);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={draft ?? preferences.data.remindersEnabled}
                disabled={busy}
                onChange={(event) => {
                  setDraft(event.target.checked);
                  setSaved(false);
                }}
              />
              Send me demo reminders
            </label>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy || draft === null || draft === preferences.data.remindersEnabled}
            >
              Save reminder settings
            </Button>
          </form>
        )}
        {preferences.isPending && <p role="status">Loading reminder settings…</p>}
        {saved && (
          <p role="status" className="text-xs">
            Reminder settings saved.
          </p>
        )}
      </div>
    </details>
  );
}
