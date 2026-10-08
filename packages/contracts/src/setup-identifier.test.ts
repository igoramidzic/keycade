import { describe, expect, it } from "vitest";
import { saveSetupIdentifierSchema } from "./setup-identifier.js";

describe("setup business EIN command", () => {
  const save = {
    definitionVersion: 2,
    expectedRevision: 1,
    action: "save",
    value: "000000001",
  };
  it("accepts only synthetic business identifiers with an explicit current setup version", () => {
    expect(saveSetupIdentifierSchema.parse(save).currentStep).toBe("industry");
    for (const invalid of [
      { ...save, value: "123456789" },
      { ...save, value: "000000008" },
      { ...save, subjectUserId: "20000000-0000-4000-8000-000000000001" },
      { ...save, kind: "ssn" },
      { ...save, authorized: true },
      { ...save, definitionVersion: 1 },
      { ...save, definitionVersion: undefined },
    ])
      expect(saveSetupIdentifierSchema.safeParse(invalid).success).toBe(false);
  });
  it("requires clear to be explicit and rejects values attached to a clear", () => {
    expect(saveSetupIdentifierSchema.safeParse({ ...save, action: "clear" }).success).toBe(false);
    expect(
      saveSetupIdentifierSchema.parse({
        definitionVersion: 2,
        expectedRevision: 2,
        action: "clear",
      }),
    ).toMatchObject({ action: "clear", expectedRevision: 2 });
  });
});
