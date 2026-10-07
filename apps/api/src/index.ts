import { loadServerEnv } from "@keycade/config/server";
import { createDatabase } from "@keycade/db";
import { assertSchemaReady } from "@keycade/db/migrate";
import { workerHealth } from "@keycade/integrations";
import { buildServer } from "./server.js";

const env = loadServerEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);
const app = await buildServer({
  db,
  allowedOrigins: env.ALLOWED_ORIGINS,
  logger: true,
  readiness: async () => {
    await assertSchemaReady(env.DATABASE_URL);
    const worker = await workerHealth(pool, env.WORKER_STALE_MS);
    return {
      status: worker.ready ? "ready" : "not_ready",
      database: "ready",
      worker: worker.ready ? "ready" : "unavailable",
      simulation: true,
    };
  },
});
app.addHook("onClose", async () => {
  await pool.end();
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close();
  });
try {
  await app.listen({ host: "127.0.0.1", port: env.API_PORT });
} catch {
  app.log.error("API startup failed. Check the configured port and local environment.");
  await app.close();
  process.exitCode = 1;
}
