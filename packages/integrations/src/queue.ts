import { createDatabase } from "@keycade/db";
import { PgBoss } from "pg-boss";
import bossPackage from "pg-boss/package.json" with { type: "json" };

export const demoQueue = "keycade-demo-v1";
export const accessQueue = "keycade-access-v1";
export function createQueueClient(
  connectionString: string,
  migrate = false,
  supervise = false,
): PgBoss {
  const boss = new PgBoss({
    connectionString,
    migrate,
    schedule: false,
    supervise,
    superviseIntervalSeconds: 1,
  });
  // Never log arbitrary driver errors (which may contain connection details).
  boss.on("error", () => {});
  return boss;
}
export async function initializeQueue(connectionString: string): Promise<void> {
  const boss = createQueueClient(connectionString, true);
  try {
    await boss.start();
    for (const name of [demoQueue, accessQueue])
      await boss.createQueue(name, {
        retryLimit: 0,
        expireInSeconds: 180,
        retentionSeconds: 86_400,
        deleteAfterSeconds: 86_400,
      });
  } finally {
    await boss.stop();
  }
}
export async function assertQueueReady(connectionString: string): Promise<void> {
  const { pool } = createDatabase(connectionString);
  try {
    const version = await pool.query<{ version: number }>("SELECT version FROM pgboss.version");
    const queue = await pool.query("SELECT name FROM pgboss.queue WHERE name = ANY($1)", [
      [demoQueue, accessQueue],
    ]);
    if (Number(version.rows[0]?.version) !== bossPackage.pgboss.schema || queue.rowCount !== 2)
      throw new Error("Queue is behind.");
  } catch {
    throw new Error("Queue schema is missing, behind, or unusable. Run pnpm initialize.");
  } finally {
    await pool.end();
  }
}
