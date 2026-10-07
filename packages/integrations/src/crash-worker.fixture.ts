import { startWorker } from "./runtime.js";

// Runs only as an isolated integration-test child. No connection string appears in argv/logs.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !/\/keycade_test_[a-f0-9]{32}$/.test(connectionString))
  throw new Error("Disposable test database required.");
const worker = await startWorker(connectionString, {
  workerId: "synthetic-crash-child",
  delayMs: 500,
  deadlineMs: 700,
  leaseMs: 800,
  pollMs: 10,
  heartbeatMs: 50,
});
process.send?.({ ready: true });
await worker.done;
