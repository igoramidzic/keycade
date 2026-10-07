import { fundedAccountsViewSchema } from "@keycade/contracts";
import { FundedAccounts } from "@keycade/ui/components/funded-accounts";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { useQuery } from "@tanstack/react-query";
import { ApiError, request } from "./api";
import { ErrorNotice } from "./workspace-ui";

export function AccountList({ session }: { session: AuthenticatedSession }) {
  const accounts = useQuery({
    queryKey: ["accounts", session.bank.id, session.user.email],
    queryFn: ({ signal }) =>
      request(`/api/v1/banks/${session.bank.id}/accounts`, fundedAccountsViewSchema, {
        signal,
        bankId: session.bank.id,
        actorEmail: session.user.email,
      }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
  });
  if (accounts.isPending || !accounts.isFetchedAfterMount)
    return (
      <p role="status" className="py-5 text-sm text-muted-foreground">
        Loading funded accounts…
      </p>
    );
  if (
    accounts.error &&
    (!accounts.data ||
      (accounts.error instanceof ApiError && [401, 403, 404].includes(accounts.error.status)))
  )
    return <ErrorNotice error={accounts.error} onRetry={() => void accounts.refetch()} />;
  if (!accounts.data) return null;
  return (
    <div>
      {accounts.error && (
        <ErrorNotice error={accounts.error} onRetry={() => void accounts.refetch()} />
      )}
      <FundedAccounts
        accounts={accounts.data.accounts}
        applicationHref={(id) =>
          `/applications/${id}/closing?bank=${encodeURIComponent(session.bank.slug)}`
        }
      />
    </div>
  );
}
