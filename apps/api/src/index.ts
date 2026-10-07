import { loadServerEnv } from "@keycade/config/server";
import { createDatabase } from "@keycade/db";
import { assertSchemaReady } from "@keycade/db/migrate";
import { workerHealth } from "@keycade/integrations";
import { createLocalDocumentStorage } from "@keycade/integrations/document-storage-local";
import { buildServer } from "./server.js";

const env = loadServerEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);
const app = await buildServer({
  db,
  encryptionKey: env.ENCRYPTION_KEY,
  documentStorage: createLocalDocumentStorage(env.PRIVATE_STORAGE_PATH),
  documentLimits: {
    maxFileBytes: env.DOCUMENT_MAX_FILE_BYTES,
    maxBatchFiles: env.DOCUMENT_MAX_BATCH_FILES,
  },
  allowedOrigins: env.ALLOWED_ORIGINS,
  nodeEnv: env.NODE_ENV,
  authDeliveryEnabled: true,
  demoInboxEnabled: env.DEMO_INBOX_ENABLED === "true",
  demoSignInEnabled: env.NODE_ENV === "development",
  portalOrigins: {
    borrower: [`http://127.0.0.1:${env.BORROWER_PORT}`, `http://localhost:${env.BORROWER_PORT}`],
    staff: [
      `http://127.0.0.1:${env.BANK_CONSOLE_PORT}`,
      `http://localhost:${env.BANK_CONSOLE_PORT}`,
    ],
  },
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
