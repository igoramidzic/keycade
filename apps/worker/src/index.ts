import { loadServerEnv } from "@keycade/config/server";
import { createIdentifierCipher } from "@keycade/domain";
import { createMailpitAdapter, startWorker } from "@keycade/integrations";
import { createLocalDocumentStorage } from "@keycade/integrations/document-storage-local";

async function main() {
  const env = loadServerEnv();
  const worker = await startWorker(env.DATABASE_URL, {
    identifierCipher: createIdentifierCipher(env.ENCRYPTION_KEY),
    documentStorage: createLocalDocumentStorage(env.PRIVATE_STORAGE_PATH),
    emailAdapter: createMailpitAdapter(env.MAILPIT_SMTP_PORT),
    delayMs: env.SIMULATION_DELAY_MS,
    deadlineMs: env.PROVIDER_DEADLINE_MS,
    pollMs: env.WORKER_POLL_MS,
    heartbeatMs: env.WORKER_HEARTBEAT_MS,
  });
  console.info(
    JSON.stringify({ event: "worker_ready", workerId: worker.workerId, simulated: true }),
  );
  const stop = () => {
    void worker.stop().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await worker.done;
  } finally {
    await worker.stop();
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({
      event: "worker_failed",
      message: "Worker startup or processing failed. Check local database readiness.",
    }),
  );
  process.exitCode = 1;
});
