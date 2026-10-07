import { seedDatabase, seedIds } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { enqueueDemo } from "@keycade/integrations";
import { expect, test } from "vitest";
import worker from "../worker";

test("Cron dispatch and queue delivery preserve durable retries and one effect after duplicate delivery", async () => {
  const database = await createTestDatabase();
  const delivered: { operationId: string }[] = [];
  const env = {
    HYPERDRIVE: { connectionString: database.connectionString },
    JOBS_QUEUE: {
      send: async (message: { operationId: string }) => {
        delivered.push(message);
      },
    },
    SIMULATION_DELAY_MS: "0",
    PROVIDER_DEADLINE_MS: "1000",
  } as unknown as JobsBindings;
  const deliver = async (body: unknown) => {
    let acknowledged = false;
    let retried = false;
    const batch = {
      messages: [
        {
          body,
          ack: () => {
            acknowledged = true;
          },
          retry: () => {
            retried = true;
          },
        },
      ],
    } as unknown as MessageBatch<{ operationId: string }>;
    await worker.queue(batch, env);
    expect(acknowledged).toBe(true);
    expect(retried).toBe(false);
  };
  try {
    await seedDatabase(database.connectionString);
    const operationId = await database.db.transaction((tx) =>
      enqueueDemo(tx, {
        bankId: seedIds.bankA,
        applicationId: seedIds.applicationSmall,
        scenario: "transient_error",
        requestId: "synthetic-cloudflare-adapter-test",
      }),
    );
    await worker.scheduled({} as ScheduledController, env);
    expect(delivered).toEqual([{ operationId }]);
    await deliver(delivered.shift());
    const retry = await database.pool.query("SELECT status FROM integration_runs WHERE id=$1", [
      operationId,
    ]);
    expect(retry.rows[0].status).toBe("retry_scheduled");
    expect(
      (
        await database.pool.query("SELECT dispatched_at FROM outbox_events WHERE run_id=$1", [
          operationId,
        ])
      ).rows[0].dispatched_at,
    ).toBeNull();
    // The dispatcher uses the runtime clock; PostgreSQL may run a few milliseconds ahead
    // in its VM. Make the retry unambiguously due without depending on either wall clock.
    await database.pool.query("UPDATE integration_runs SET available_at = $2 WHERE id=$1", [
      operationId,
      new Date(0),
    ]);
    await worker.scheduled({} as ScheduledController, env);
    expect(delivered).toEqual([{ operationId }]);
    await deliver(delivered[0]);
    await deliver(delivered[0]);
    expect(
      (await database.pool.query("SELECT status FROM integration_runs WHERE id=$1", [operationId]))
        .rows[0].status,
    ).toBe("succeeded");
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM effect_deduplications WHERE operation_id=$1",
          [operationId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM audit_events WHERE target_id=$1 AND action='simulation.completed'",
          [operationId],
        )
      ).rows[0].n,
    ).toBe(1);
    await deliver({ operationId: "invalid" });
  } finally {
    await database.cleanup();
  }
});
