import type { ApplicationPortal } from "@keycade/contracts";
import { describe, expect, it } from "vitest";
import { applicationProgress } from "./application-progress";

const base = {
  status: "collecting_information",
  setupStatus: "completed",
  timelineEvents: [],
  fundedAccountId: null,
  accessScope: "full",
} satisfies Parameters<typeof applicationProgress>[0];
const state = (status: ApplicationPortal["status"], key: string) =>
  applicationProgress({ ...base, status }).find((step) => step.key === key);

describe("borrower application timeline", () => {
  it("keeps setup completion distinct from application submission", () => {
    expect(state("collecting_information", "setup")?.state).toBe("complete");
    expect(state("collecting_information", "application")?.state).toBe("current");
    expect(state("collecting_information", "underwriting")?.state).toBe("upcoming");
    expect(state("submitted", "underwriting")?.description).toBe("Awaiting lender review");
    expect(state("in_review", "underwriting")?.description).toBe("Lender review in progress");
  });
  it("retains prior underwriting when the lender requests more information", () => {
    const steps = applicationProgress({
      ...base,
      status: "needs_information",
      timelineEvents: [
        { id: "review", status: "in_review", createdAt: "2026-10-08T12:00:00.000Z" },
      ],
    });
    expect(steps.find((step) => step.key === "application")).toMatchObject({
      state: "current",
      description: "Needs your action",
    });
    expect(steps.find((step) => step.key === "underwriting")?.state).toBe("previous");
    expect(steps.find((step) => step.key === "decision")?.state).toBe("upcoming");
  });
  it("does not turn approval into completed closing or funding", () => {
    expect(state("approved", "decision")?.state).toBe("complete");
    expect(state("approved", "closing")?.state).toBe("upcoming");
    expect(state("closing", "closing")?.state).toBe("current");
    expect(state("closing", "funding")?.state).toBe("upcoming");
  });
  it("preserves reached approval and closing milestones when later withdrawn", () => {
    const steps = applicationProgress({
      ...base,
      status: "withdrawn",
      timelineEvents: ["approved", "closing", "withdrawn"].map((status) => ({
        id: status,
        status: status as "approved" | "closing" | "withdrawn",
        createdAt: "2026-10-08T12:00:00.000Z",
      })),
    });
    expect(steps.find((step) => step.key === "decision")).toMatchObject({
      state: "previous",
      description: "Approval recorded before withdrawal",
    });
    expect(steps.find((step) => step.key === "closing")).toMatchObject({
      state: "previous",
      description: "Closing started before withdrawal",
    });
    expect(steps.find((step) => step.key === "funding")?.state).toBe("stopped");
  });
  it.each(["declined", "withdrawn"] as const)(
    "does not mark later stages completed for %s",
    (status) => {
      const steps = applicationProgress({ ...base, status });
      expect(
        steps
          .filter((step) => ["decision", "closing", "funding", "booked"].includes(step.key))
          .every((step) => step.state === "stopped"),
      ).toBe(true);
      expect(steps.find((step) => step.key === "underwriting")?.state).toBe("stopped");
    },
  );
  it("shows Loan Booked only as completion of an existing linked funded account", () => {
    expect(state("funded", "booked")?.state).toBe("upcoming");
    expect(
      applicationProgress({ ...base, status: "funded", fundedAccountId: "recorded-account" }).find(
        (step) => step.key === "booked",
      ),
    ).toMatchObject({ state: "complete", description: "Simulated loan account recorded" });
    expect(
      applicationProgress({ ...base, status: "funded", accessScope: "assigned" }).some(
        (step) => step.key === "booked",
      ),
    ).toBe(false);
  });
});
