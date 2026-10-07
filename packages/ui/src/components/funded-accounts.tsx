import { Badge } from "@keycade/ui/components/badge";
import { buttonVariants } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";

export type FundedAccountData = {
  id: string;
  applicationId: string;
  businessId: string;
  businessName: string;
  productName: string;
  approvedAmount: string;
  fundedAmount: string;
  fundedOn: string;
  reference: string;
};
export function exactUsd(value: string) {
  const [whole, fraction = "00"] = value.split(".");
  return `$${whole?.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
export function fundingDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}
export function FundedAccountCard({
  account,
  applicationHref,
}: {
  account: FundedAccountData;
  applicationHref?: string;
}) {
  return (
    <article aria-label={`Funded account ${account.id}`}>
      <Card className="ring-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle>
              <h3>{account.productName}</h3>
            </CardTitle>
            <Badge variant="secondary">Simulated</Badge>
          </div>
          <CardDescription className="break-words">
            {account.businessName} · Account {account.id.slice(-8)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="text-sm text-muted-foreground">Recorded funded amount</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">
              {exactUsd(account.fundedAmount)}
            </p>
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Approved amount</dt>
              <dd className="mt-1 font-medium">{exactUsd(account.approvedAmount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Funding date (UTC)</dt>
              <dd className="mt-1">
                <time dateTime={account.fundedOn}>{fundingDate(account.fundedOn)}</time>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Funding reference</dt>
              <dd className="mt-1 break-words">{account.reference}</dd>
            </div>
          </dl>
          <p className="text-xs leading-5 text-muted-foreground">
            This is a single simulated funding record. No money was moved. It does not represent an
            outstanding balance, available credit, or repayment schedule.
          </p>
          {applicationHref && (
            <a href={applicationHref} className={buttonVariants({ variant: "outline" })}>
              View funded account
            </a>
          )}
        </CardContent>
      </Card>
    </article>
  );
}
export function FundedAccounts({
  accounts,
  applicationHref,
}: {
  accounts: FundedAccountData[];
  applicationHref: (applicationId: string) => string;
}) {
  const groups = new Map<string, FundedAccountData[]>();
  for (const account of accounts)
    groups.set(account.businessId, [...(groups.get(account.businessId) ?? []), account]);
  return (
    <section aria-label="Funded accounts" className="space-y-5 pt-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Funded accounts</h2>
        <p className="text-sm text-muted-foreground">
          Recorded simulated funding, grouped by business.
        </p>
      </div>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No funded accounts are available for your account yet.
        </p>
      ) : (
        [...groups].map(([id, items]) => (
          <section
            key={id}
            aria-label={`Funded accounts for ${items[0]?.businessName}`}
            className="space-y-3"
          >
            <h3 className="break-words font-medium">{items[0]?.businessName}</h3>
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {items.map((account) => (
                <FundedAccountCard
                  key={account.id}
                  account={account}
                  applicationHref={applicationHref(account.applicationId)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
