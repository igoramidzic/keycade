import { staffApplicationPageSchema, staffOptionsSchema } from "@keycade/contracts";
import { Badge } from "@keycade/ui/components/badge";
import { Button, buttonVariants } from "@keycade/ui/components/button";
import { EmptyState } from "@keycade/ui/components/empty-state";
import { Input } from "@keycade/ui/components/input";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { PageHeader } from "@keycade/ui/components/page-header";
import { applicationStatusTone, StatusText } from "@keycade/ui/components/status-pill";
import { cn } from "@keycade/ui/lib/utils";
import { workflowName, workflowText } from "@keycade/ui/lib/workflow-text";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search, SearchX, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AccountList } from "./accounts";
import { formatAmount, useStaffApi } from "./api";
import { ErrorNotice, Field, Loading, SetupBadge, statusLabels, stepLabels } from "./ui";

/** Shared column template so the header row and every application row align. */
const columns =
  "lg:grid-cols-[minmax(0,2.3fr)_minmax(0,1.35fr)_minmax(0,0.95fr)_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.95fr)]";

export function ApplicationQueue() {
  const api = useStaffApi();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const savedSearch = params.get("search") ?? "";
  useEffect(() => setSearch(savedSearch), [savedSearch]);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const query = new URLSearchParams();
  for (const key of ["search", "status", "productId", "assigneeId", "sort", "limit"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  query.set("page", String(page));
  const encoded = query.toString();
  const options = useQuery({
    queryKey: ["staff-options"],
    queryFn: ({ signal }) => api.request("/options", staffOptionsSchema, { signal }),
  });
  const applications = useQuery({
    queryKey: ["staff-queue", encoded],
    queryFn: ({ signal }) =>
      api.request(`/applications?${encoded}`, staffApplicationPageSchema, { signal }),
  });
  function change(key: string, value: string) {
    // Router navigation commits the URL before React necessarily renders new search params.
    // Compose quick consecutive filter changes from that committed location.
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  }
  const bankQuery = params.get("bank")
    ? `?bank=${encodeURIComponent(params.get("bank") ?? "")}`
    : "";
  const filtered = ["search", "status", "productId", "assigneeId"].some((key) => params.get(key));
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={api.bankName}
        title="Applications"
        description="Find drafts, follow saved setup progress, and coordinate your bank’s applications."
        actions={
          <Link to={`/applications/new${bankQuery}`} className={buttonVariants()}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            Create application
          </Link>
        }
      />
      <section aria-label="Application filters" className="rounded-xl border bg-card shadow-xs">
        <form
          className="flex items-end gap-3 border-b p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            change("search", search.trim());
          }}
        >
          <div className="min-w-0 flex-1">
            <Field id="search" label="Search applications">
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="search"
                  value={search}
                  maxLength={200}
                  className="pl-9"
                  placeholder="Business, email, or application ID"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </Field>
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-5">
          <Field id="stage" label="Stage">
            <NativeSelect
              id="stage"
              className="w-full"
              value={params.get("status") ?? ""}
              onChange={(event) => change("status", event.target.value)}
            >
              <option value="">All stages</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="product" label="Product">
            <NativeSelect
              id="product"
              className="w-full"
              disabled={!options.data}
              value={params.get("productId") ?? ""}
              onChange={(event) => change("productId", event.target.value)}
            >
              <option value="">All products</option>
              {options.data?.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {workflowName(product.name)} · v{product.version}
                  {product.active ? "" : " (inactive)"}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="assignee" label="Assignee">
            <NativeSelect
              id="assignee"
              className="w-full"
              disabled={!options.data}
              value={params.get("assigneeId") ?? ""}
              onChange={(event) => change("assigneeId", event.target.value)}
            >
              <option value="">All officers</option>
              <option value="unassigned">Unassigned</option>
              {options.data?.officers.map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {workflowName(officer.displayName)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="sort" label="Sort by">
            <NativeSelect
              id="sort"
              className="w-full"
              value={params.get("sort") ?? "updated_desc"}
              onChange={(event) => change("sort", event.target.value)}
            >
              <option value="updated_desc">Recently updated</option>
              <option value="created_desc">Newest first</option>
              <option value="created_asc">Oldest first</option>
              <option value="business_asc">Business name A–Z</option>
            </NativeSelect>
          </Field>
          <Field id="limit" label="Rows per page">
            <NativeSelect
              id="limit"
              className="w-full"
              value={params.get("limit") ?? "25"}
              onChange={(event) => change("limit", event.target.value)}
            >
              {[5, 25, 50].map((limit) => (
                <option key={limit} value={limit}>
                  {limit}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/40 px-4 py-2.5 sm:px-5">
          {applications.data ? (
            <p role="status" className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                {applications.data.total}
              </span>{" "}
              {applications.data.total === 1 ? "application" : "applications"} found
            </p>
          ) : (
            <span />
          )}
          <Button
            variant="ghost"
            size="sm"
            className={cn(!filtered && "text-muted-foreground")}
            onClick={() => {
              setSearch("");
              setParams(params.get("bank") ? { bank: params.get("bank") ?? "" } : {});
            }}
          >
            <X aria-hidden="true" data-icon="inline-start" />
            Clear filters
          </Button>
        </div>
      </section>
      {options.error && (
        <ErrorNotice error={options.error} onRetry={() => void options.refetch()} />
      )}
      {applications.isPending ? (
        <Loading />
      ) : applications.error ? (
        <ErrorNotice error={applications.error} onRetry={() => void applications.refetch()} />
      ) : (
        applications.data && (
          <div className="space-y-4">
            {applications.data.items.length ? (
              <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
                <div
                  aria-hidden="true"
                  className={cn(
                    "hidden gap-4 border-b bg-muted/50 px-5 py-2.5 text-xs font-medium text-muted-foreground lg:grid",
                    columns,
                  )}
                >
                  <span>Business</span>
                  <span>Stage</span>
                  <span className="text-right">Requested</span>
                  <span>Officer</span>
                  <span>Required tasks</span>
                  <span>Updated</span>
                </div>
                <div className="divide-y">
                  {applications.data.items.map((item) => (
                    <article
                      key={item.id}
                      aria-label={`Application ${item.id}`}
                      className={cn(
                        "grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-muted/30 sm:px-5 lg:items-center",
                        columns,
                      )}
                    >
                      <div className="col-span-2 min-w-0 space-y-1 lg:col-span-1">
                        <Link
                          to={`/applications/${item.id}/overview${bankQuery}${bankQuery ? "&" : "?"}queue=${encodeURIComponent(params.toString())}`}
                          className="block font-semibold break-words text-foreground underline-offset-4 hover:text-info hover:underline"
                        >
                          {workflowName(item.businessName ?? "Untitled application")}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.contactEmail ?? "Contact not provided"}
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <SetupBadge status={item.setupStatus} />
                          <Badge variant="outline">
                            {item.source === "staff"
                              ? "Staff created"
                              : item.source === "borrower"
                                ? "Borrower created"
                                : "Existing record"}
                          </Badge>
                        </div>
                      </div>
                      <QueueCell label="Stage">
                        <StatusText tone={applicationStatusTone(item.status)}>
                          {statusLabels[item.status]}
                        </StatusText>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {item.setupStatus === "completed"
                            ? (item.productName ?? "Product not provided")
                            : `Next: ${stepLabels[item.currentStep]}`}
                        </span>
                      </QueueCell>
                      <QueueCell label="Requested amount" className="lg:text-right">
                        <span className="font-semibold tabular-nums">
                          {formatAmount(item.requestedAmount)}
                        </span>
                      </QueueCell>
                      <QueueCell label="Assigned officer">
                        <span className={cn(!item.assignedStaffName && "text-muted-foreground")}>
                          {item.assignedStaffName ?? "Unassigned"}
                        </span>
                      </QueueCell>
                      <QueueCell label="Required tasks satisfied">
                        {item.taskProgress ? (
                          <span className="block space-y-1.5">
                            <span className="block tabular-nums">
                              {item.taskProgress.requiredCompleted} of {item.taskProgress.required}
                            </span>
                            <TaskMeter
                              value={item.taskProgress.requiredCompleted}
                              max={item.taskProgress.required}
                            />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </QueueCell>
                      <QueueCell label="Last updated">
                        <time dateTime={item.updatedAt} className="text-sm text-muted-foreground">
                          {new Date(item.updatedAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </time>
                      </QueueCell>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                titleAs="h2"
                icon={SearchX}
                title="No applications found"
                description="Try different filters or create a new application."
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Page {page} of {Math.max(1, applications.data.totalPages)}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => change("page", String(page - 1))}
                >
                  <ChevronLeft aria-hidden="true" data-icon="inline-start" />
                  Previous page
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= applications.data.totalPages}
                  onClick={() => change("page", String(page + 1))}
                >
                  Next page
                  <ChevronRight aria-hidden="true" data-icon="inline-end" />
                </Button>
              </div>
            </div>
          </div>
        )
      )}
      <AccountList />
    </div>
  );
}

/** A labelled value that reads as a table cell on desktop and a labelled field when stacked. */
function QueueCell({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 text-sm", className)}>
      <p className="mb-1 text-xs font-medium text-muted-foreground lg:sr-only">{label}</p>
      {children}
    </div>
  );
}

function TaskMeter({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 w-full max-w-28 overflow-hidden rounded-full bg-muted"
    >
      <span className="block h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
    </span>
  );
}
