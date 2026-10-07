import { spawn } from "node:child_process";
import { projectRoot } from "@keycade/config/server";
import { assertSchemaReady, migrateDatabase } from "@keycade/db/migrate";
import { seedDatabase } from "@keycade/db/seed";
import {
  assertLocalTarget,
  assertOwnedDatabase,
  checkRuntime,
  generateEnvironment,
  localEnv,
  preparePrivateStorage,
  startServices,
  stopServices,
  waitForDatabase,
} from "./local-lib";

async function main() {
  const command = process.argv[2];
  checkRuntime();
  if (command === "initialize") generateEnvironment();
  const env = localEnv();
  assertLocalTarget(env);
  if (command === "initialize" || command === "infra:start" || command === "db:start") {
    console.log("Checking project-owned local infrastructure…");
    await startServices(env, command !== "db:start");
    await waitForDatabase(env);
    console.log("PostgreSQL authenticated SELECT 1 passed.");
    if (command !== "initialize") return;
    assertOwnedDatabase(env);
    await migrateDatabase(env.DATABASE_URL);
    const { initializeQueue } = await import("@keycade/integrations");
    await initializeQueue(env.DATABASE_URL);
    await seedDatabase(env.DATABASE_URL);
    preparePrivateStorage(env);
    console.log(
      "Committed migrations, queue initialization, and idempotent synthetic seeds completed.",
    );
    console.log(
      `Run pnpm dev. Bank: http://127.0.0.1:${env.BANK_SITE_PORT} · Borrower: http://127.0.0.1:${env.BORROWER_PORT} · Staff: http://127.0.0.1:${env.BANK_CONSOLE_PORT}`,
    );
    console.log(
      `Local inbox: http://127.0.0.1:${env.MAILPIT_UI_PORT} · Studio: pnpm db:studio · Stop infrastructure: pnpm infra:stop`,
    );
  } else if (command === "db:stop" || command === "infra:stop")
    stopServices(env, command === "infra:stop");
  else if (command === "db:status") {
    assertOwnedDatabase(env);
    await waitForDatabase(env, 1);
    await assertSchemaReady(env.DATABASE_URL);
    console.log("Project-owned PostgreSQL is running; authenticated SQL and schema checks passed.");
  } else if (command === "db:migrate" || command === "db:seed" || command === "db:studio") {
    assertOwnedDatabase(env);
    await waitForDatabase(env, 1);
    if (command === "db:migrate") {
      await migrateDatabase(env.DATABASE_URL);
      const { initializeQueue } = await import("@keycade/integrations");
      await initializeQueue(env.DATABASE_URL);
      console.log("Committed database migrations and queue schema applied.");
    } else if (command === "db:seed") {
      await assertSchemaReady(env.DATABASE_URL);
      await seedDatabase(env.DATABASE_URL);
      console.log("Synthetic fixtures seeded idempotently.");
    } else {
      console.log(
        "Starting Drizzle Studio on 127.0.0.1:4983 (local only). Open https://local.drizzle.studio",
      );
      const child = spawn(
        "pnpm",
        [
          "--filter",
          "@keycade/db",
          "exec",
          "drizzle-kit",
          "studio",
          "--host",
          "127.0.0.1",
          "--port",
          "4983",
        ],
        {
          cwd: projectRoot,
          env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
          stdio: "inherit",
        },
      );
      for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.once(signal, () => child.kill(signal));
      child.once("exit", (code) => {
        process.exitCode = code ?? 0;
      });
    }
  } else throw new Error("Unknown local command.");
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Local command failed.");
  process.exitCode = 1;
});
