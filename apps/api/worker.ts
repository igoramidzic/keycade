import { createDatabase } from "@keycade/db";
import { assertWorkerSchemaReady } from "@keycade/db/cloudflare";
import { createR2DocumentStorage } from "@keycade/integrations/document-storage-r2";
import { handleWorkerRequest } from "./src/worker-handler";

export default {
  async fetch(request, env) {
    // Hyperdrive owns pooling at the edge; the app pool belongs only to this request.
    const { db, pool } = createDatabase(env.HYPERDRIVE.connectionString, { max: 1 });
    try {
      return await handleWorkerRequest(request, {
        db,
        documentStorage: createR2DocumentStorage(
          env.DOCUMENTS,
          (size) => new FixedLengthStream(size),
        ),
        allowedOrigins: env.ALLOWED_ORIGINS.split(","),
        nodeEnv: "production",
        // T06 delivery is through local Mailpit. Do not promise an email on the hosted shell.
        authDeliveryEnabled: false,
        demoSignInEnabled: false,
        rateLimiter: env.API_RATE_LIMITER,
        readiness: async () => {
          await assertWorkerSchemaReady(pool);
          const response = await env.JOBS.fetch("https://jobs.internal/internal/ready");
          const result: unknown = await response.json();
          const ready =
            response.ok &&
            typeof result === "object" &&
            result !== null &&
            "status" in result &&
            result.status === "ready";
          return {
            status: ready ? "ready" : "not_ready",
            database: "ready",
            worker: ready ? "ready" : "unavailable",
            simulation: true,
          };
        },
      });
    } finally {
      await pool.end();
    }
  },
} satisfies ExportedHandler<ApiBindings>;
