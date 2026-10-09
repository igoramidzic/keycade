import { createDatabase } from "@keycade/db";
import { assertWorkerSchemaReady } from "@keycade/db/cloudflare";
import { createR2DocumentStorage } from "@keycade/integrations/document-storage-r2";
import { handleWorkerRequest } from "./src/worker-handler";

export default {
  async fetch(request, env, ctx) {
    const startedAt = performance.now();
    const demoInboxEnabled =
      env.DEMO_INBOX_ENABLED === "true" && /^[a-f0-9]{64}$/.test(env.ENCRYPTION_KEY ?? "");
    // Hyperdrive owns pooling at the edge; the app pool belongs only to this request.
    const { db, pool } = createDatabase(env.HYPERDRIVE.connectionString, { max: 1 });
    try {
      const response = await handleWorkerRequest(request, {
        db,
        encryptionKey: env.ENCRYPTION_KEY,
        documentStorage: createR2DocumentStorage(
          env.DOCUMENTS,
          (size) => new FixedLengthStream(size),
        ),
        allowedOrigins: env.ALLOWED_ORIGINS.split(","),
        nodeEnv: "production",
        // Every deployed environment is a synthetic demo; no real email/identity provider exists.
        authDeliveryEnabled: demoInboxEnabled,
        demoSignInEnabled: true,
        demoInboxEnabled,
        portalOrigins: { borrower: [env.BORROWER_ORIGIN], staff: [env.STAFF_ORIGIN] },
        rateLimiter: env.API_RATE_LIMITER,
        readiness: async () => {
          if (!demoInboxEnabled) throw new Error("Simulated delivery is unavailable.");
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
      const durationMs = Math.round(performance.now() - startedAt);
      response.headers.set("server-timing", `api;dur=${durationMs}`);
      // No raw URL, query, identity, cookie or document content enters the logs.
      const pathname = new URL(request.url).pathname;
      const resource =
        pathname.match(
          /\/(session|tasks|documents|readiness|review|portal|checks|closing|options|accounts)(?:\/|$)/,
        )?.[1] ?? (/\/staff\/applications$/.test(pathname) ? "staff-applications" : "other");
      console.info({
        event: "api.request",
        resource,
        method: request.method,
        status: response.status,
        durationMs,
      });
      if (response.ok && ["POST", "PATCH", "DELETE"].includes(request.method)) {
        // Persisted work is authoritative. This best-effort queue wake shortens demo latency;
        // Cron recovers the same durable intents if the wake fails.
        ctx.waitUntil(
          env.JOBS.fetch("https://jobs.internal/internal/dispatch", { method: "POST" })
            .then(async (wake) => {
              await wake.body?.cancel();
              if (!wake.ok) console.warn("Demo job wake deferred to scheduled recovery.");
            })
            .catch(() => console.warn("Demo job wake deferred to scheduled recovery.")),
        );
      }
      return response;
    } finally {
      await pool.end();
    }
  },
} satisfies ExportedHandler<ApiBindings>;
