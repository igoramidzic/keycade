import { staffApplicationPageSchema, staffOptionsSchema } from "@keycade/contracts";
import { Badge } from "@keycade/ui/components/badge";
import { Button, buttonVariants } from "@keycade/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@keycade/ui/components/card";
import { Input } from "@keycade/ui/components/input";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AccountList } from "./accounts";
import { formatAmount, useStaffApi } from "./api";
import { ErrorNotice, Field, Loading, SetupBadge, statusLabels, stepLabels } from "./ui";

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
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  }
  const bankQuery = params.get("bank")
    ? `?bank=${encodeURIComponent(params.get("bank") ?? "")}`
    : "";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Applications</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Find drafts, follow saved setup progress, and coordinate your bank’s applications.
          </p>
        </div>
        <Link to={`/applications/new${bankQuery}`} className={buttonVariants()}>
          Create application
        </Link>
      </div>
      <Card>
        <CardContent className="space-y-5 pt-5">
          <form
            className="flex items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              change("search", search.trim());
            }}
          >
            <div className="min-w-0 flex-1">
              <Field id="search" label="Search applications">
                <Input
                  id="search"
                  value={search}
                  maxLength={200}
                  placeholder="Business, email, or application ID"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </Field>
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
                    {product.name} · v{product.version}
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
                    {officer.displayName}
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setParams(params.get("bank") ? { bank: params.get("bank") ?? "" } : {});
            }}
          >
            Clear filters
          </Button>
        </CardContent>
      </Card>
      {options.error && (
        <ErrorNotice error={options.error} onRetry={() => void options.refetch()} />
      )}
      {applications.isPending ? (
        <Loading />
      ) : applications.error ? (
        <ErrorNotice error={applications.error} onRetry={() => void applications.refetch()} />
      ) : (
        applications.data && (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              {applications.data.total}{" "}
              {applications.data.total === 1 ? "application" : "applications"} found
            </p>
            {applications.data.items.length ? (
              <div className="space-y-3">
                {applications.data.items.map((item) => (
                  <article
                    key={item.id}
                    aria-label={`Application ${item.id}`}
                    className="rounded-xl border p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 space-y-2">
                        <Link
                          to={`/applications/${item.id}/overview${bankQuery}`}
                          className="break-words text-lg font-medium underline-offset-4 hover:underline"
                        >
                          {item.businessName ?? "Untitled application"}
                        </Link>
                        <p className="break-all text-sm text-muted-foreground">
                          {item.contactEmail ?? "Contact not provided"}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">{statusLabels[item.status]}</Badge>
                          <SetupBadge status={item.setupStatus} />
                          <Badge variant="outline">
                            {item.source === "staff"
                              ? "Staff created"
                              : item.source === "borrower"
                                ? "Borrower created"
                                : "Synthetic fixture"}
                          </Badge>
                        </div>
                      </div>
                      <p className="font-medium">{formatAmount(item.requestedAmount)}</p>
                    </div>
                    <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Product</dt>
                        <dd>{item.productName ?? "Not provided"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Assigned officer</dt>
                        <dd>{item.assignedStaffName ?? "Unassigned"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Saved setup step</dt>
                        <dd>
                          {item.setupStatus === "completed"
                            ? "Completed"
                            : stepLabels[item.currentStep]}
                        </dd>
                      </div>
                      {item.taskProgress && (
                        <div>
                          <dt className="text-muted-foreground">Required tasks satisfied</dt>
                          <dd>
                            {item.taskProgress.requiredCompleted} of {item.taskProgress.required}
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt className="text-muted-foreground">Last updated</dt>
                        <dd>{new Date(item.updatedAt).toLocaleString()}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>No applications found</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Try different filters or create a new application.
                  </p>
                </CardContent>
              </Card>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Page {page} of {Math.max(1, applications.data.totalPages)}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => change("page", String(page - 1))}
                >
                  Previous page
                </Button>
                <Button
                  variant="outline"
                  disabled={page >= applications.data.totalPages}
                  onClick={() => change("page", String(page + 1))}
                >
                  Next page
                </Button>
              </div>
            </div>
          </>
        )
      )}
      <AccountList />
    </div>
  );
}
