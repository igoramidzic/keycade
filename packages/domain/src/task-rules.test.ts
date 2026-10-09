import { describe, expect, it } from "vitest";
import {
  calculateTaskProgress,
  demoRequirementRules,
  evaluateRequirementRules,
  requirementsPassStage,
  taskDone,
  taskPasses,
  taskTransitionAllowed,
} from "./task-rules.js";

const facts = {
  requestedAmount: "10000.00",
  businessName: "Synthetic LLC",
  industryCode: null,
  owners: [],
};
describe("declarative demo requirements", () => {
  it("varies checklists by product and decimal amount without UI thresholds", () => {
    const normal = evaluateRequirementRules(demoRequirementRules("business-credit"), facts);
    const large = evaluateRequirementRules(demoRequirementRules("business-credit"), {
      ...facts,
      requestedAmount: "100000.00",
    });
    expect(normal.some((x) => x.key === "use-of-funds")).toBe(false);
    expect(large.some((x) => x.key === "use-of-funds")).toBe(true);
    expect(
      evaluateRequirementRules(demoRequirementRules("equipment-finance"), facts).some(
        (x) => x.key === "equipment-description",
      ),
    ).toBe(true);
    expect(
      evaluateRequirementRules(demoRequirementRules("business-credit"), {
        ...facts,
        requestedAmount: "99999.99",
      }).some((x) => x.key === "use-of-funds"),
    ).toBe(false);
  });
  it("keeps unknown industry, entity and identifiers at approval", () => {
    const tasks = evaluateRequirementRules(demoRequirementRules("business-credit"), facts);
    expect(
      tasks.filter((x) => ["industry", "entity-details", "tax-document-readiness"].includes(x.key)),
    ).toHaveLength(3);
    expect(
      tasks
        .filter((x) => ["industry", "entity-details", "tax-document-readiness"].includes(x.key))
        .every((x) => x.stage === "approval"),
    ).toBe(true);
    expect(
      evaluateRequirementRules(demoRequirementRules("business-credit"), {
        ...facts,
        industryCode: "5415",
      }).some((x) => x.key === "industry"),
    ).toBe(false);
  });
  it("uses per-owner identities and rule-specific current-input fingerprints", () => {
    const rules = demoRequirementRules("business-credit");
    const input = {
      ...facts,
      requestedAmount: "100000.00",
      owners: [
        { id: "owner-1", userId: "u1" },
        { id: "owner-2", userId: "u2" },
      ],
    };
    const tasks = evaluateRequirementRules(rules, input);
    expect(new Set(tasks.filter((x) => x.subject === "owner").map((x) => x.stableKey)).size).toBe(
      2,
    );
    const changed = evaluateRequirementRules(rules, { ...input, requestedAmount: "200000.00" });
    expect(changed.find((x) => x.key === "use-of-funds")?.inputFingerprint).not.toBe(
      tasks.find((x) => x.key === "use-of-funds")?.inputFingerprint,
    );
    expect(changed.find((x) => x.key === "business-overview")?.inputFingerprint).toBe(
      tasks.find((x) => x.key === "business-overview")?.inputFingerprint,
    );
  });
});
describe("task evidence and stage rules", () => {
  const completed = {
    state: "completed" as const,
    stage: "submission" as const,
    required: true,
    evidenceRevision: 2,
    reviewedEvidenceRevision: 2,
  };
  it("counts only current completed evidence and waivers; excludes cancelled occurrences", () => {
    const tasks = [
      completed,
      { ...completed, state: "cancelled" as const },
      { ...completed, state: "waived" as const, evidenceRevision: 0, reviewedEvidenceRevision: 0 },
      { ...completed, evidenceRevision: 3 },
    ];
    expect(calculateTaskProgress(tasks)).toMatchObject({
      total: 3,
      completed: 2,
      required: 3,
      requiredCompleted: 2,
    });
  });
  it("counts work the assignee completed before lender review, but not toward reviewed evidence", () => {
    const awaiting = { ...completed, state: "submitted" as const, reviewedEvidenceRevision: null };
    expect(taskDone(awaiting)).toBe(true);
    expect(taskPasses(awaiting)).toBe(false);
    expect(taskDone({ ...awaiting, evidenceRevision: 0 })).toBe(false);
    expect(taskDone({ ...awaiting, state: "needs_changes" as const })).toBe(false);
    expect(
      calculateTaskProgress([awaiting, { ...awaiting, state: "open" as const }]),
    ).toMatchObject({ total: 2, completed: 1, required: 2, requiredCompleted: 1 });
  });
  it("ignores optional and later-stage tasks at a gate and blocks stale evidence", () => {
    const tasks = [
      completed,
      { ...completed, stage: "closing" as const, state: "open" as const },
      { ...completed, state: "open" as const, required: false },
    ];
    expect(requirementsPassStage(tasks, "approval")).toBe(true);
    expect(requirementsPassStage(tasks, "closing")).toBe(false);
    expect(requirementsPassStage([{ ...completed, evidenceRevision: 3 }], "submission")).toBe(
      false,
    );
  });
  it("requires separate answer, submission and review; edits can reopen completed/waived evidence", () => {
    expect(taskTransitionAllowed("open", "review")).toBe(false);
    expect(taskTransitionAllowed("submitted", "review")).toBe(true);
    expect(taskTransitionAllowed("completed", "answer")).toBe(true);
    expect(taskTransitionAllowed("waived", "answer")).toBe(true);
    expect(taskTransitionAllowed("cancelled", "answer")).toBe(false);
    expect(taskTransitionAllowed("submitted", "submit")).toBe(false);
    expect(taskTransitionAllowed("completed", "waive")).toBe(false);
  });
});
