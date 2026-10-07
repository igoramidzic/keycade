import { spawn } from "node:child_process";
import { projectRoot } from "@keycade/config/server";
import { assertLocalTarget, assertOwnedDatabase, localEnv, waitForDatabase } from "./local-lib";

async function main() {
  const env = localEnv();
  assertLocalTarget(env);
  assertOwnedDatabase(env);
  await waitForDatabase(env, 1);
  const child = spawn("pnpm", ["exec", "vitest", "run", ".integration.test.ts"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, TEST_DATABASE_URL: env.DATABASE_URL },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Integration runner failed.");
  process.exitCode = 1;
});
