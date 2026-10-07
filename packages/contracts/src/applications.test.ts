import { describe, expect, it } from "vitest";
import {
  createDraftSchema,
  publicStartApplicationSchema,
  saveApplicationSetupSchema,
} from "./applications.js";

const idempotencyKey = "10000000-0000-4000-8000-000000000001";

describe("initial application wire contracts", () => {
  it("requires a high-entropy public request key and allows email-first starts", () => {
    expect(
      publicStartApplicationSchema.parse({
        email: "applicant@example.test",
        bankSlug: "bank-a",
        idempotencyKey: "a".repeat(64),
      }),
    ).toMatchObject({ email: "applicant@example.test", bankSlug: "bank-a" });
    expect(
      publicStartApplicationSchema.safeParse({
        email: "applicant@example.test",
        bankSlug: "bank-a",
        idempotencyKey,
      }).success,
    ).toBe(false);
    expect(createDraftSchema.parse({ idempotencyKey })).toEqual({ idempotencyKey });
  });

  it.each(["10000.00", "5000000.00", "7500000.00"])(
    "preserves the exact amount string %s",
    (requestedAmount) => {
      const result = saveApplicationSetupSchema.parse({
        expectedRevision: 1,
        answers: { requestedAmount },
        currentStep: "amount",
      });
      expect(result.answers.requestedAmount).toBe(requestedAmount);
    },
  );

  it("allows partial staff prefills while rejecting setup control and private identifiers", () => {
    expect(
      createDraftSchema.parse({
        email: "applicant@example.test",
        idempotencyKey,
        answers: { businessName: "  Synthetic workshop  " },
      }),
    ).toMatchObject({ answers: { businessName: "Synthetic workshop" } });
    for (const answers of [
      { businessName: "" },
      { requestedAmount: 10000 },
      { requestedAmount: "10000.001" },
      { ein: "synthetic-value" },
      { ssn: "synthetic-value" },
      { completedAt: "2026-10-07T12:00:00.000Z" },
      { currentStep: "review" },
      { status: "collecting_information" },
    ])
      expect(createDraftSchema.safeParse({ idempotencyKey, answers }).success).toBe(false);
  });

  it.each(["ein", "ssn", "completedAt", "completed", "status"])(
    "rejects client control of %s in generic draft answers",
    (field) => {
      expect(
        saveApplicationSetupSchema.safeParse({
          expectedRevision: 1,
          answers: { [field]: "synthetic-value" },
          currentStep: "business_name",
        }).success,
      ).toBe(false);
      expect(
        createDraftSchema.safeParse({ idempotencyKey, [field]: "synthetic-value" }).success,
      ).toBe(false);
    },
  );

  it("rejects client completion flags and invalid progress without coercing revisions", () => {
    const input = { expectedRevision: 1, answers: {}, currentStep: "review" };
    for (const invalid of [
      { ...input, completed: true },
      { ...input, expectedRevision: "1" },
      { ...input, expectedRevision: 0 },
      { ...input, currentStep: "unknown" },
      { ...input, step: "review" },
      { ...input, answers: { requestedAmount: 10000 } },
    ]) {
      expect(saveApplicationSetupSchema.safeParse(invalid).success).toBe(false);
    }
    expect(
      saveApplicationSetupSchema.parse({
        ...input,
        step: "industry",
        skip: true,
        answers: { industryCode: null, industryTaxonomyVersion: null },
      }),
    ).toMatchObject({ skip: true, currentStep: "review" });
  });
});
