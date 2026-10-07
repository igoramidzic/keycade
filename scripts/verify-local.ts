// Maintainer acceptance probe: only creates/deletes its own synthetic bank row.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { envFile } from "@keycade/config/server";
import { createDatabase } from "@keycade/db";
import { assertOwnedDatabase, localEnv, run, waitForDatabase } from "./local-lib";

const env = localEnv();
assertOwnedDatabase(env);
const { pool } = createDatabase(env.DATABASE_URL);
const id = randomUUID();
function expectDevFailure(url: string) {
  const result = spawnSync("pnpm", ["dev"], {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, DATABASE_URL: url },
  });
  assert.equal(result.status, 1, "Development must exit nonzero on unusable DB");
  assert.match(result.stdout + result.stderr, /Database readiness failed/);
  assert.doesNotMatch(result.stdout + result.stderr, /Launching three frontends/);
  assert(!result.error, "Readiness must fail within the bounded preflight");
}
const wrongCredentials = new URL(env.DATABASE_URL);
wrongCredentials.password = "incorrect-synthetic-probe-password";
expectDevFailure(wrongCredentials.toString());
console.log("Bad database credentials refuse pnpm dev before launching apps.");
const before = readFileSync(envFile, "utf8");
try {
  await pool.query("INSERT INTO banks(id,slug,name,synthetic) VALUES($1,$2,$3,true)", [
    id,
    `setup-probe-${id}`,
    "Synthetic initialization preservation probe",
  ]);
  run("pnpm", ["initialize"], { inherit: true, timeout: 120000 });
  assert.equal(readFileSync(envFile, "utf8"), before, "Existing env content must be unchanged");
  assert.equal((await pool.query("SELECT id FROM banks WHERE id=$1", [id])).rowCount, 1);
  await pool.end();
  run("pnpm", ["db:stop"], { inherit: true });
  const bad = await (async () => {
    try {
      await waitForDatabase(env, 1);
      return false;
    } catch {
      return true;
    }
  })();
  assert(bad, "Stopped database must fail readiness");
  expectDevFailure(env.DATABASE_URL);
  run("pnpm", ["db:start"], { inherit: true, timeout: 120000 });
  await waitForDatabase(env);
  // Reconnect because the old connection was terminated when its container stopped.
  const again = createDatabase(env.DATABASE_URL);
  try {
    assert.equal((await again.pool.query("SELECT id FROM banks WHERE id=$1", [id])).rowCount, 1);
  } finally {
    await again.pool.end();
  }
  console.log(
    "Repeated initialize preserves env and records; stopped database fails; stop/start preserves volume data.",
  );
} finally {
  if (!pool.ended) await pool.end();
  const cleanup = createDatabase(env.DATABASE_URL);
  try {
    await cleanup.pool.query("DELETE FROM banks WHERE id=$1", [id]);
  } finally {
    await cleanup.pool.end();
  }
}
