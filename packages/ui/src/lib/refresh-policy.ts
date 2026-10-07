export const activeRefreshMs = 3_000;
export const idleRefreshMs = 30_000;

export function documentRefreshInterval(
  data:
    | {
        documents: {
          currentVersionId: string | null;
          versions: {
            id: string;
            uploadState: string;
            scanState: string;
            processing: { state: string } | null;
          }[];
        }[];
      }
    | undefined,
) {
  const active = data?.documents.some((document) =>
    document.versions.some(
      (version) =>
        version.id === document.currentVersionId &&
        version.uploadState === "uploaded" &&
        (version.scanState === "pending" ||
          ["queued", "processing"].includes(version.processing?.state ?? "")),
    ),
  );
  return active ? activeRefreshMs : idleRefreshMs;
}

export function checkRefreshInterval(
  data:
    | {
        checks: {
          currentRunId: string | null;
          runs: { id: string; status: string; stale: boolean }[];
        }[];
      }
    | undefined,
) {
  const active = data?.checks.some((check) =>
    check.runs.some(
      (run) =>
        run.id === check.currentRunId &&
        !run.stale &&
        ["queued", "running", "retry_scheduled"].includes(run.status),
    ),
  );
  return active ? activeRefreshMs : idleRefreshMs;
}

export function readinessRefreshInterval(
  data:
    | {
        gates: { blockers: { reason: string }[] }[];
      }
    | undefined,
) {
  const active = data?.gates.some((gate) =>
    gate.blockers.some((blocker) =>
      ["check_queued", "check_running", "check_retry_scheduled"].includes(blocker.reason),
    ),
  );
  return active ? activeRefreshMs : idleRefreshMs;
}
