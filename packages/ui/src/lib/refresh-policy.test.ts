import { expect, test } from "vitest";
import {
  checkRefreshInterval,
  documentRefreshInterval,
  readinessRefreshInterval,
} from "./refresh-policy";

test("document polling is fast only while the current uploaded version is processing", () => {
  const version = {
    id: "current",
    uploadState: "uploaded",
    scanState: "clean",
    processing: { state: "classified" },
  };
  const data = {
    documents: [
      {
        currentVersionId: version.id,
        versions: [version, { ...version, id: "old", scanState: "pending" }],
      },
    ],
  };
  expect(documentRefreshInterval(data)).toBe(30_000);
  version.processing.state = "queued";
  expect(documentRefreshInterval(data)).toBe(3_000);
  version.processing.state = "failed";
  expect(documentRefreshInterval(data)).toBe(30_000);
  version.scanState = "pending";
  expect(documentRefreshInterval(data)).toBe(3_000);
  version.uploadState = "staged";
  expect(documentRefreshInterval(data)).toBe(30_000);
});

test("checks waiting for input, stale runs and finished work do not poll rapidly", () => {
  const run = { id: "current", status: "waiting_for_input", stale: false };
  const data = {
    checks: [{ currentRunId: run.id, runs: [run, { id: "old", status: "running", stale: true }] }],
  };
  expect(checkRefreshInterval(data)).toBe(30_000);
  run.status = "running";
  expect(checkRefreshInterval(data)).toBe(3_000);
  run.stale = true;
  expect(checkRefreshInterval(data)).toBe(30_000);
});

test("readiness speeds up for executing checks and slows down for human input or settled gates", () => {
  const blocker = { reason: "check_waiting_for_input" };
  const data = { gates: [{ blockers: [blocker] }] };
  expect(readinessRefreshInterval(data)).toBe(30_000);
  blocker.reason = "check_queued";
  expect(readinessRefreshInterval(data)).toBe(3_000);
  blocker.reason = "check_failed";
  expect(readinessRefreshInterval(data)).toBe(30_000);
  expect(readinessRefreshInterval({ gates: [{ blockers: [] }] })).toBe(30_000);
});
