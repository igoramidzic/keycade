import { randomUUID } from "node:crypto";
import { tasksViewSchema, taskViewSchema } from "@keycade/contracts";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => database?.cleanup());
const origin = "http://localhost:3001";
const csrf = "synthetic-task-csrf-token-01234567890";
const base = `/api/v1/banks/${ids.bankA}/applications/${ids.applicationSmall}/tasks`;

for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} task workflow on PostgreSQL`, () => {
    async function client(userId: string) {
      const options = {
        db: database.db,
        allowedOrigins: [origin],
        authenticate: async () => ({ actor: { kind: "user" as const, userId }, csrfToken: csrf }),
        readiness: async () => ({
          status: "ready" as const,
          database: "ready" as const,
          worker: "ready" as const,
          simulation: true as const,
        }),
      };
      const app = await buildServer(options);
      return {
        close: () => app.close(),
        async call(
          path: string,
          method: "GET" | "POST" | "PATCH" = "GET",
          body?: object,
          proof = csrf,
        ) {
          const headers = { origin, "x-csrf-token": proof, "content-type": "application/json" };
          if (transport === "fastify") {
            const response = await app.inject({
              method,
              url: path,
              headers,
              ...(body ? { payload: body } : {}),
            });
            return { status: response.statusCode, body: response.json() };
          }
          const response = await handleWorkerRequest(
            new Request(origin + path, {
              method,
              headers,
              ...(body ? { body: JSON.stringify(body) } : {}),
            }),
            { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
          );
          return { status: response.status, body: await response.json() };
        },
      };
    }

    it("separates saving, submission, return and completion; rejects stale reviews and invalid waiver reasons", async () => {
      const staff = await client(ids.officerA);
      const borrower = await client(ids.borrower);
      try {
        const initial = await staff.call(base);
        expect(initial.status).toBe(200);
        const workspace = tasksViewSchema.parse(initial.body);
        const assignee = workspace.assignees.find((person) => person.userId === ids.borrower);
        expect(assignee).toBeDefined();
        const input = {
          title: `Synthetic request ${randomUUID()}`,
          description: "Describe the fictional equipment purchase.",
          assigneeParticipantId: assignee?.id,
          idempotencyKey: randomUUID(),
        };
        expect((await staff.call(base, "POST", input, "")).status).toBe(403);
        expect((await borrower.call(base, "POST", input)).status).toBe(404);
        const created = await staff.call(base, "POST", input);
        expect(created.status, JSON.stringify(created.body)).toBe(200);
        const task = tasksViewSchema
          .parse(created.body)
          .tasks.find((item) => item.title === input.title);
        if (!task) throw new Error("Expected synthetic manual task.");
        const taskPath = `${base}/${task.id}`;
        expect(
          (await staff.call(base, "POST", input)).body.tasks.filter(
            (item: { id: string }) => item.id === task.id,
          ),
        ).toHaveLength(1);
        expect(
          (
            await borrower.call(`${taskPath}/answer`, "PATCH", {
              expectedRevision: task.revision,
              answer: "Synthetic proposal",
              status: "completed",
            })
          ).status,
        ).toBe(400);
        const saved = await borrower.call(`${taskPath}/answer`, "PATCH", {
          expectedRevision: task.revision,
          answer: "Synthetic proposal",
        });
        expect(saved.status).toBe(200);
        let current = taskViewSchema.parse(saved.body);
        expect(current.state).toBe("open");
        expect(
          (
            await borrower.call(`${taskPath}/review`, "POST", {
              expectedRevision: current.revision,
              decision: "completed",
              reason: "Not a reviewer",
            })
          ).status,
        ).toBe(404);
        let submitted = await borrower.call(`${taskPath}/submit`, "POST", {
          expectedRevision: current.revision,
        });
        expect(submitted.status).toBe(200);
        current = taskViewSchema.parse(submitted.body);
        expect(current.state).toBe("submitted");
        const returned = await staff.call(`${taskPath}/review`, "POST", {
          expectedRevision: current.revision,
          decision: "needs_changes",
          reason: "Describe the equipment in more detail.",
        });
        expect(returned.status).toBe(200);
        current = taskViewSchema.parse(returned.body);
        expect(current.state).toBe("needs_changes");
        const revised = await borrower.call(`${taskPath}/answer`, "PATCH", {
          expectedRevision: current.revision,
          answer: "Synthetic woodworking equipment and delivery.",
        });
        expect(revised.status).toBe(200);
        current = taskViewSchema.parse(revised.body);
        submitted = await borrower.call(`${taskPath}/submit`, "POST", {
          expectedRevision: current.revision,
        });
        expect(submitted.status).toBe(200);
        current = taskViewSchema.parse(submitted.body);
        const review = {
          expectedRevision: current.revision,
          decision: "completed",
          reason: "Synthetic explanation reviewed.",
        };
        const results = await Promise.all([
          staff.call(`${taskPath}/review`, "POST", review),
          staff.call(`${taskPath}/review`, "POST", review),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
        const detail = taskViewSchema.parse((await borrower.call(taskPath)).body);
        expect(detail.state).toBe("completed");
        expect(detail.answers).toHaveLength(2);
        expect(detail.reviews).toHaveLength(2);
        expect(
          (
            await staff.call(`${taskPath}/waive`, "POST", {
              expectedRevision: detail.revision,
              reason: " ",
            })
          ).status,
        ).toBe(400);
        const spec = await staff.call("/api/openapi.json");
        expect(
          spec.body.paths[
            "/api/v1/banks/{bankId}/applications/{applicationId}/tasks/{taskId}/review"
          ].post.responses,
        ).toHaveProperty("409");
      } finally {
        await Promise.all([staff.close(), borrower.close()]);
      }
    });

    it("links an owner without granting access and renews private requirements after restoration", async () => {
      const staff = await client(ids.officerA);
      const borrower = await client(ids.borrower);
      const adviser = await client(ids.adviser);
      try {
        const people = base.replace(/\/tasks$/, "/participants");
        const name = `Synthetic HTTP owner ${randomUUID()}`;
        const created = await staff.call(`${people}/relationships`, "POST", {
          displayName: name,
          kind: "owner",
          ownershipPercent: "20.00",
          idempotencyKey: randomUUID(),
        });
        expect(created.status).toBe(200);
        const relationship = created.body.relationships.find(
          (item: { displayName: string }) => item.displayName === name,
        );
        const linked = await staff.call(`${people}/relationships/${relationship.id}/user`, "POST", {
          userId: ids.borrower,
          idempotencyKey: randomUUID(),
        });
        expect(linked.status).toBe(200);
        const tasks = tasksViewSchema.parse((await borrower.call(base)).body).tasks;
        const task = tasks.find(
          (item) => item.stableKey.endsWith(relationship.id) && item.state !== "cancelled",
        );
        if (!task) throw new Error("Expected private synthetic owner task.");
        expect(task.visibility).toBe("private");
        expect((await adviser.call(`${base}/${task.id}`)).status).toBe(404);
        expect(
          (
            await borrower.call(`${base}/${task.id}/answer`, "PATCH", {
              expectedRevision: task.revision,
              answer: "123-45-6789",
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await borrower.call(`${base}/${task.id}/answer`, "PATCH", {
              expectedRevision: task.revision,
              answer: "confirmed",
            })
          ).status,
        ).toBe(200);
        for (const active of [false, true]) {
          expect(
            (
              await staff.call(`${people}/relationships/${relationship.id}/status`, "POST", {
                active,
                idempotencyKey: randomUUID(),
              })
            ).status,
          ).toBe(200);
        }
        const restored = tasksViewSchema
          .parse((await borrower.call(base)).body)
          .tasks.find((item) => item.stableKey === task.stableKey && item.state !== "cancelled");
        expect(restored).toMatchObject({
          state: "open",
          occurrence: task.occurrence + 1,
          evidenceRevision: 0,
        });
        expect(restored?.id).not.toBe(task.id);
        expect(
          taskViewSchema.parse((await borrower.call(`${base}/${task.id}`)).body).answers[0]?.answer,
        ).toBe("confirmed");
      } finally {
        await Promise.all([staff.close(), borrower.close(), adviser.close()]);
      }
    });

    it("conceals unrelated tasks and counts and keeps the applicant setup gate", async () => {
      const borrower = await client(ids.borrower);
      const adviser = await client(ids.adviser);
      try {
        for (const path of [
          base.replace(ids.bankA, ids.bankB),
          base.replace(ids.applicationSmall, ids.applicationUnshared),
          `${base}/${randomUUID()}`,
        ]) {
          const response = await borrower.call(path);
          expect(response.status).toBe(404);
          expect(response.body.error.code).toBe("NOT_FOUND");
        }
        const blocked = await borrower.call(
          base.replace(ids.applicationSmall, ids.applicationSetupDraft),
        );
        expect(blocked.status).toBe(409);
        expect(blocked.body.error.code).toBe("SETUP_REQUIRED");
        const workspace = tasksViewSchema.parse((await adviser.call(base)).body);
        expect(workspace.tasks).toEqual([]);
        expect(workspace.progress.total).toBe(0);
        expect(workspace.assignees).toEqual([]);
        const applicantTasks = tasksViewSchema.parse((await borrower.call(base)).body).tasks;
        if (!applicantTasks[0]) throw new Error("Expected synthetic requirements.");
        expect((await adviser.call(`${base}/${applicantTasks[0].id}`)).status).toBe(404);
      } finally {
        await Promise.all([borrower.close(), adviser.close()]);
      }
    });
  });
}
