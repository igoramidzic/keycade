import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createTestDatabase } from "@keycade/db/testing";
import { afterEach, describe, expect, it } from "vitest";

const intakeSql = await readFile(
  new URL("../infra/bootstrap-demo-intake.sql", import.meta.url),
  "utf8",
);
const accessSql = await readFile(
  new URL("../infra/bootstrap-demo-access.sql", import.meta.url),
  "utf8",
);
let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
afterEach(async () => {
  await database?.cleanup();
  database = undefined;
});
async function fixture() {
  database = await createTestDatabase();
  await database.pool.query(intakeSql);
  return database;
}
async function bootstrap() {
  if (!database) throw new Error("Missing synthetic fixture.");
  const client = await database.pool.connect();
  try {
    await client.query(accessSql);
  } catch (error) {
    // A failed explicit SQL transaction remains aborted until the same connection rolls back.
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
describe("hosted synthetic staff bootstrap on PostgreSQL", () => {
  it("is repeatable and preserves existing identity fields and application progress", async () => {
    const db = await fixture();
    await bootstrap();
    const before = await db.pool.query(
      "SELECT u.*, m.id AS membership_id, m.role FROM users u JOIN bank_memberships m ON m.user_id = u.id WHERE u.email = 'officer-a@example.test'",
    );
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0]).toMatchObject({ synthetic: true, role: "admin" });
    const officerId = before.rows[0].id;
    const bank = await db.pool.query("SELECT id FROM banks WHERE slug = 'bank-a'");
    const applicationId = randomUUID();
    await db.pool.query(
      "UPDATE users SET display_name = 'Synthetic preserved name' WHERE id = $1",
      [officerId],
    );
    await db.pool.query(
      "INSERT INTO applications (id, bank_id, source, status, revision, business_name, synthetic) VALUES ($1,$2,'seed','draft',9,'Synthetic preserved application',true)",
      [applicationId, bank.rows[0].id],
    );
    await db.pool.query(
      "INSERT INTO application_setups (bank_id, application_id, current_step, completed_steps, revision) VALUES ($1,$2,'purpose',ARRAY['business_name','amount'],6)",
      [bank.rows[0].id, applicationId],
    );
    await bootstrap();
    await bootstrap();
    const after = await db.pool.query(
      "SELECT u.*, m.id AS membership_id, m.role FROM users u JOIN bank_memberships m ON m.user_id = u.id WHERE u.email = 'officer-a@example.test'",
    );
    expect(after.rows).toEqual([{ ...before.rows[0], display_name: "Synthetic preserved name" }]);
    const progress = await db.pool.query(
      "SELECT a.revision, a.business_name, s.current_step, s.completed_steps, s.revision AS setup_revision FROM applications a JOIN application_setups s ON s.application_id = a.id WHERE a.id = $1",
      [applicationId],
    );
    expect(progress.rows).toEqual([
      {
        revision: 9,
        business_name: "Synthetic preserved application",
        current_step: "purpose",
        completed_steps: ["business_name", "amount"],
        setup_revision: 6,
      },
    ]);
    expect((await db.pool.query("SELECT count(*)::int AS count FROM users")).rows[0].count).toBe(1);
    expect(
      (await db.pool.query("SELECT count(*)::int AS count FROM bank_memberships")).rows[0].count,
    ).toBe(1);
  });

  it("does not restore revoked membership or upgrade an existing officer role", async () => {
    const db = await fixture();
    await bootstrap();
    await db.pool.query(
      "UPDATE bank_memberships SET role = 'officer', revoked_at = '2026-10-07T12:00:00Z'",
    );
    const before = await db.pool.query("SELECT * FROM bank_memberships");
    await bootstrap();
    expect((await db.pool.query("SELECT * FROM bank_memberships")).rows).toEqual(before.rows);
  });

  it("refuses a non-synthetic email collision and rolls back the fixture transaction", async () => {
    const db = await fixture();
    const userId = randomUUID();
    await db.pool.query(
      "INSERT INTO users (id, email, display_name, synthetic) VALUES ($1,'officer-a@example.test','Reserved non-synthetic test identity',false)",
      [userId],
    );
    const before = await db.pool.query("SELECT * FROM users");
    await expect(bootstrap()).rejects.toThrow(
      "Demo officer collides with a non-synthetic identity",
    );
    expect((await db.pool.query("SELECT * FROM users")).rows).toEqual(before.rows);
    expect((await db.pool.query("SELECT * FROM bank_memberships")).rows).toEqual([]);
  });

  it("refuses non-synthetic bank or membership fixtures without modifying them", async () => {
    const db = await fixture();
    await db.pool.query("UPDATE banks SET synthetic = false WHERE slug = 'bank-a'");
    await expect(bootstrap()).rejects.toThrow("Synthetic bank-a is required");
    expect((await db.pool.query("SELECT * FROM users")).rows).toEqual([]);
    await db.pool.query("UPDATE banks SET synthetic = true WHERE slug = 'bank-a'");
    await bootstrap();
    await db.pool.query("UPDATE bank_memberships SET synthetic = false");
    const before = await db.pool.query("SELECT * FROM bank_memberships");
    await expect(bootstrap()).rejects.toThrow("Existing staff membership is not synthetic");
    expect((await db.pool.query("SELECT * FROM bank_memberships")).rows).toEqual(before.rows);
  });
});
