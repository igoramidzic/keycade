import { describe, expect, it } from "vitest";
import {
  type ApplicationAccess,
  canDelegateParticipantGrant,
  participantResourceAllowed,
} from "../src/index.js";

const actorUserId = "20000000-0000-4000-8000-000000000001";
const otherUserId = "20000000-0000-4000-8000-000000000002";
const resourceId = "30000000-0000-4000-8000-000000000001";
const otherId = "30000000-0000-4000-8000-000000000002";
const grant = (
  role: "applicant_admin" | "owner" | "adviser",
  scope: "full" | "assigned",
  listed = true,
): ApplicationAccess => ({
  kind: "participant",
  participantId: "40000000-0000-4000-8000-000000000001",
  role,
  scope,
  taskIds: listed ? [resourceId] : [otherId],
  documentIds: listed ? [resourceId] : [otherId],
});

describe("participant task/document policy matrix", () => {
  for (const kind of ["task", "document"] as const) {
    for (const role of ["applicant_admin", "owner", "adviser"] as const) {
      for (const scope of ["full", "assigned"] as const) {
        for (const listed of [true, false]) {
          it(`${kind}: ${role}/${scope}, ${listed ? "explicit" : "absent"} scope never grants another person's private evidence`, () => {
            const access = grant(role, scope, listed);
            const allows = (
              visibility: "shared" | "assigned" | "private",
              subjectUserId: string | null = null,
            ) =>
              participantResourceAllowed({
                actorUserId,
                access,
                resource: { id: resourceId, kind, visibility, subjectUserId },
              });
            expect(allows("private", otherUserId)).toBe(false);
            expect(allows("private", null)).toBe(false);
            expect(allows("shared")).toBe(scope === "full" || listed);
            expect(allows("assigned")).toBe(listed);
            expect(allows("private", actorUserId)).toBe(scope === "full" || listed);
          });
        }
      }
    }
    for (const role of ["officer", "admin"] as const) {
      it(`${kind}: bank ${role} can use bank-authorized resources`, () => {
        for (const visibility of ["shared", "assigned", "private"] as const)
          expect(
            participantResourceAllowed({
              actorUserId,
              access: { kind: "staff", role },
              resource: { id: resourceId, kind, visibility, subjectUserId: otherUserId },
            }),
          ).toBe(true);
      });
    }
    it(`${kind}: system application read capability does not grant resource access`, () => {
      expect(
        participantResourceAllowed({
          actorUserId,
          access: { kind: "system" },
          resource: { id: resourceId, kind, visibility: "shared" },
        }),
      ).toBe(false);
    });
    it(`${kind}: task and document grants cannot substitute for one another`, () => {
      const access = grant("adviser", "assigned", false);
      if (access.kind !== "participant") throw new Error("Expected participant fixture.");
      access.taskIds = kind === "task" ? [] : [resourceId];
      access.documentIds = kind === "document" ? [] : [resourceId];
      expect(
        participantResourceAllowed({
          actorUserId,
          access,
          resource: { id: resourceId, kind, visibility: "assigned" },
        }),
      ).toBe(false);
    });
  }
});

describe("participant delegation matrix", () => {
  const accesses: ApplicationAccess[] = [
    { kind: "staff", role: "officer" },
    { kind: "staff", role: "admin" },
    { kind: "system" },
    ...(["applicant_admin", "owner", "adviser"] as const).flatMap((role) =>
      (["full", "assigned"] as const).map((scope) => grant(role, scope)),
    ),
  ];
  for (const access of accesses) {
    it(`${access.kind}${access.kind === "system" ? "" : `/${access.role}`}${access.kind === "participant" ? `/${access.scope}` : ""} delegates only authorized application roles`, () => {
      for (const role of ["applicant_admin", "owner", "adviser"] as const) {
        for (const scope of ["full", "assigned"] as const) {
          const validRoleScope = role !== "applicant_admin" || scope === "full";
          const expected = validRoleScope && access.kind === "staff";
          expect(canDelegateParticipantGrant(access, { role, scope })).toBe(expected);
        }
      }
    });
  }
});
