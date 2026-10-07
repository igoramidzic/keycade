import { randomUUID } from "node:crypto";
import { createDatabase } from "@keycade/db";
import { assertSchemaReady } from "@keycade/db/migrate";
import { seedIds } from "@keycade/db/seed";
import { enqueueDemo, scenarioSchema, workerHealth } from "@keycade/integrations";
import { assertOwnedDatabase, localEnv, waitForDatabase } from "./local-lib";

async function main() {
  const env = localEnv();
  assertOwnedDatabase(env);
  await waitForDatabase(env, 1);
  await assertSchemaReady(env.DATABASE_URL);
  const parsed = scenarioSchema.safeParse(process.argv[2] ?? "success");
  if (!parsed.success)
    throw new Error(
      "Use: pnpm jobs:demo [success|missing_input|transient_error|timeout|terminal_error]",
    );
  const { db, pool } = createDatabase(env.DATABASE_URL);
  try {
    if (!(await workerHealth(pool, env.WORKER_STALE_MS)).ready)
      throw new Error("No healthy local worker. Start pnpm dev, then rerun pnpm jobs:demo.");
    const operationId = await db.transaction((tx) =>
      enqueueDemo(tx, {
        bankId: seedIds.bankA,
        applicationId: seedIds.applicationSmall,
        scenario: parsed.data,
        requestId: randomUUID(),
        maxAttempts: env.JOB_MAX_ATTEMPTS,
      }),
    );
    console.log(
      `Simulated ${parsed.data} operation ${operationId} committed. No real provider is called.`,
    );
    let previous = "";
    const until = Date.now() + env.JOB_MAX_ATTEMPTS * (env.PROVIDER_DEADLINE_MS + 5000) + 10000;
    while (Date.now() < until) {
      const result = await pool.query<{ status: string; attempts: number; stale: boolean }>(
        "SELECT status,attempts,stale FROM integration_runs WHERE id=$1",
        [operationId],
      );
      const run = result.rows[0];
      if (!run) throw new Error("Operation record is missing.");
      const state = `${run.status} · attempt ${run.attempts}/${env.JOB_MAX_ATTEMPTS}${run.stale ? " · stale input ignored" : ""}`;
      if (state !== previous) {
        console.log(state);
        previous = state;
      }
      if (
        ["succeeded", "waiting_for_input", "failed", "timed_out", "cancelled"].includes(run.status)
      ) {
        const effects = await pool.query<{ count: string }>(
          "SELECT count(*) FROM effect_deduplications WHERE operation_id=$1",
          [operationId],
        );
        console.log(
          `Logical effects: ${effects.rows[0]?.count}. Inspect integration_runs, outbox_events and audit_events in pnpm db:studio.`,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      "Operation is still pending. Its durable state is preserved; check pnpm dev worker output and Studio.",
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Demo command failed.");
  process.exitCode = 1;
});
