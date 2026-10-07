import { randomBytes } from "node:crypto";
import { createTestDatabase } from "@keycade/db/testing";
import { Client } from "pg";
import { expect, test } from "vitest";
import { configureRuntimeRole, runtimeRole } from "./neon-runtime-lib";

test("runtime login can use application tables but cannot migrate or edit audit history", async () => {
  const database = await createTestDatabase();
  const admin = new Client({ connectionString: database.connectionString });
  let runtime: Client | undefined;
  let created = false;
  try {
    await admin.connect();
    const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [runtimeRole]);
    if (exists.rowCount) throw new Error("Runtime role already exists in this test cluster.");
    const password = randomBytes(32).toString("base64url");
    await configureRuntimeRole(admin, password);
    created = true;
    await configureRuntimeRole(admin, password);
    const url = new URL(database.connectionString);
    url.username = runtimeRole;
    url.password = password;
    runtime = new Client({ connectionString: url.toString() });
    await runtime.connect();
    expect((await runtime.query("SELECT count(*)::int AS count FROM banks")).rows[0].count).toBe(0);
    expect(
      (await runtime.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations"))
        .rows[0].count,
    ).toBeGreaterThan(0);
    await expect(runtime.query("CREATE TABLE forbidden_runtime_ddl (id int)")).rejects.toThrow();
    await expect(runtime.query("UPDATE audit_events SET action = 'forbidden'")).rejects.toThrow();
    await expect(runtime.query("DELETE FROM audit_events")).rejects.toThrow();
    await expect(runtime.query("CREATE ROLE forbidden_runtime_role")).rejects.toThrow();
    expect(
      (
        await runtime.query(
          "INSERT INTO banks (name, slug, synthetic) VALUES ('Synthetic runtime test', 'runtime-test', true) RETURNING id",
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await runtime?.end();
    if (created) {
      await admin.query("DROP OWNED BY keycade_runtime");
      await admin.query("DROP ROLE keycade_runtime");
    }
    await admin.end();
    await database.cleanup();
  }
});
