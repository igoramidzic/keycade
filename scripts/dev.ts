import { spawn } from "node:child_process";
import { projectRoot } from "@keycade/config/server";
import { assertSchemaReady } from "@keycade/db/migrate";
import { assertPortFree, localEnv, preparePrivateStorage, waitForDatabase } from "./local-lib";

async function main() {
  const env = localEnv();
  console.log(
    "Development preflight: checking authenticated database access and committed schema…",
  );
  await waitForDatabase(env, 3);
  await assertSchemaReady(env.DATABASE_URL);
  const { assertQueueReady } = await import("@keycade/integrations");
  await assertQueueReady(env.DATABASE_URL);
  preparePrivateStorage(env);
  for (const port of [env.API_PORT, env.BANK_SITE_PORT, env.BORROWER_PORT, env.BANK_CONSOLE_PORT])
    await assertPortFree(port);
  console.log(
    "Database/schema/queue preflight passed. Launching three frontends, API, and worker…",
  );
  const child = spawn("pnpm", ["exec", "turbo", "run", "dev"], {
    cwd: projectRoot,
    stdio: "inherit",
    detached: process.platform !== "win32",
    env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
  });
  const signal = (value: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.platform === "win32" ? child.kill(value) : process.kill(-child.pid, value);
    } catch {
      /* already stopped */
    }
  };
  for (const value of ["SIGINT", "SIGTERM"] as const) process.once(value, () => signal(value));
  child.on("error", () => {
    console.error("Could not launch workspace development processes.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    signal("SIGTERM");
    process.exitCode = code ?? 0;
  });
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Development startup failed.");
  process.exitCode = 1;
});
