import { loadServerEnv } from "@keycade/config/server";
import { startWorker } from "@keycade/integrations";

async function main() {
  const env = loadServerEnv();
  const worker = await startWorker(env.DATABASE_URL, {
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
