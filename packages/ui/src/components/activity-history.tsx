import { Button } from "@keycade/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import { ChevronRight } from "lucide-react";

type Entry = {
  id: string;
  createdAt: string;
  description: string;
  actor: string;
  reference: string | null;
};
export function ActivityHistory({
  entries,
  more,
  busy,
  loadMore,
  refresh,
}: {
  entries: Entry[];
  more: boolean;
  busy: boolean;
  loadMore(): void;
  refresh(): void;
}) {
  return (
    <section
      className="space-y-6 rounded-xl bg-card p-5 shadow-sm sm:p-6"
      aria-label="Application activity"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Application activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Progress and changes you can access. All activity is simulated.
          </p>
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={refresh}>
          Refresh activity
        </Button>
      </div>
      {!entries.length ? (
        <p className="text-sm text-muted-foreground">No activity is available yet.</p>
      ) : (
        <ol className="space-y-6">
          {entries.map((entry) => (
            <li key={entry.id} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
                <p className="text-sm font-medium">{entry.description}</p>
                <time className="text-xs text-muted-foreground" dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="text-xs text-muted-foreground">{entry.actor}</p>
              {entry.reference && (
                <Collapsible className="text-xs text-muted-foreground">
                  <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 w-full text-left">
                    <ChevronRight
                      aria-hidden="true"
                      className="size-3.5 shrink-0 transition-transform in-data-panel-open:rotate-90"
                    />
                    Support reference
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <code className="mt-1 block break-all">{entry.reference}</code>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </li>
          ))}
        </ol>
      )}
      {more && (
        <Button loading={busy} type="button" variant="outline" disabled={busy} onClick={loadMore}>
          Load earlier activity
        </Button>
      )}
    </section>
  );
}
