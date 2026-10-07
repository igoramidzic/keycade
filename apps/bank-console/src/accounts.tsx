import { fundedAccountsViewSchema } from "@keycade/contracts";
import { FundedAccounts } from "@keycade/ui/components/funded-accounts";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ApiError, useStaffApi } from "./api";
import { ErrorNotice, Loading } from "./ui";

export function AccountList() {
  const api = useStaffApi();
  const [params] = useSearchParams();
  const bank = params.get("bank");
  const accounts = useQuery({
    queryKey: ["staff-accounts"],
    queryFn: ({ signal }) =>
      api.participantRequest("/accounts", fundedAccountsViewSchema, { signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
  });
  if (accounts.isPending || !accounts.isFetchedAfterMount)
    return <Loading>Loading funded accounts…</Loading>;
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
          `/applications/${id}/closing${bank ? `?bank=${encodeURIComponent(bank)}` : ""}`
        }
      />
    </div>
  );
}
