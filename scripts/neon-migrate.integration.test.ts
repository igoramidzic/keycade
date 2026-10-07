import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationsFolder } from "@keycade/db/migrate";
import { createTestDatabase } from "@keycade/db/testing";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  applyCommittedMigrations,
  committedMigrationPlan,
  migrationLock,
} from "./neon-migrate-lib";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let databaseName: string;
let folder: string;
const clients: Client[] = [];
const committedCount = committedMigrationPlan().length;

async function connection() {
  const client = new Client({ connectionString: database.connectionString });
  clients.push(client);
  await client.connect();
  return client;
}

beforeAll(async () => {
  // Existing helper refuses remote targets and creates a generated disposable database.
  database = await createTestDatabase();
  databaseName = new URL(database.connectionString).pathname.slice(1);
});

beforeEach(async () => {
  // Reset ONLY the disposable test database, never the configured/admin database.
  await database.pool.query(
    "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
  );
  folder = mkdtempSync(join(tmpdir(), "keycade-neon-migrations-"));
  cpSync(migrationsFolder, folder, { recursive: true });
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end()));
  if (folder) rmSync(folder, { recursive: true, force: true });
});
afterAll(async () => database?.cleanup());

describe("hosted migration algorithm on disposable real PostgreSQL", () => {
  test("applies committed SQL without seeding and reruns without changing existing records", async () => {
    const client = await connection();
    expect(await applyCommittedMigrations(client, databaseName, folder)).toEqual({
      applied: committedCount,
      total: committedCount,
    });
    const empty = await client.query("SELECT count(*)::int AS count FROM banks");
    expect(empty.rows[0].count).toBe(0);
    await client.query(
      "INSERT INTO banks (name, slug, synthetic) VALUES ('Synthetic CI retention', 'ci-retention', true)",
    );
    expect(await applyCommittedMigrations(client, databaseName, folder)).toEqual({
      applied: 0,
      total: committedCount,
    });
    const preserved = await client.query("SELECT name FROM banks WHERE slug = 'ci-retention'");
    expect(preserved.rows).toEqual([{ name: "Synthetic CI retention" }]);
  });

  test("refuses a connected database whose name differs before creating a migration table", async () => {
    const client = await connection();
    await expect(applyCommittedMigrations(client, "other_database", folder)).rejects.toThrow(
      "connected database differs",
    );
    expect(
      (await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS history")).rows[0]
        .history,
    ).toBeNull();
  });

  test("rejects changed historical SQL and an older checkout without applying anything", async () => {
    const client = await connection();
    await applyCommittedMigrations(client, databaseName, folder);
    const journalPath = join(folder, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const path = join(folder, `${journal.entries[0].tag}.sql`);
    writeFileSync(path, `${readFileSync(path, "utf8")}\n-- changed historical migration\n`);
    await expect(applyCommittedMigrations(client, databaseName, folder)).rejects.toThrow(
      "history differs",
    );
    cpSync(migrationsFolder, folder, { recursive: true });
    const removed = journal.entries.pop();
    rmSync(join(folder, `${removed.tag}.sql`));
    writeFileSync(journalPath, JSON.stringify(journal));
    await expect(applyCommittedMigrations(client, databaseName, folder)).rejects.toThrow(
      "older checkout",
    );
    expect(
      (await client.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations"))
        .rows[0].count,
    ).toBe(committedCount);
  });

  test("rejects altered migration timestamps even when hashes match", async () => {
    const client = await connection();
    await applyCommittedMigrations(client, databaseName, folder);
    await client.query(
      "UPDATE drizzle.__drizzle_migrations SET created_at = created_at + 1 WHERE id = 1",
    );
    await expect(applyCommittedMigrations(client, databaseName, folder)).rejects.toThrow(
      "history differs",
    );
  });

  test("serializes concurrent migrators on the same connection as their history checks", async () => {
    const lockHolder = await connection();
    await lockHolder.query("SELECT pg_advisory_lock($1, $2)", [...migrationLock]);
    const first = await connection();
    const second = await connection();
    const results = Promise.all([
      applyCommittedMigrations(first, databaseName, folder),
      applyCommittedMigrations(second, databaseName, folder),
    ]);
    try {
      let waiting = 0;
      const deadline = Date.now() + 5_000;
      while (waiting < 2 && Date.now() < deadline) {
        const locks = await database.pool.query(
          "SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = $1 AND objid = $2 AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
          [...migrationLock],
        );
        waiting = locks.rows[0].count;
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(2);
    } finally {
      await lockHolder.query("SELECT pg_advisory_unlock($1, $2)", [...migrationLock]);
    }
    const finished = await results;
    expect(finished.map((result) => result.applied).sort((left, right) => left - right)).toEqual([
      0,
      committedCount,
    ]);
    expect(
      (await database.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations"))
        .rows[0].count,
    ).toBe(committedCount);
  });

  test("rolls back failed pending SQL, redacts database details, and releases the lock", async () => {
    const client = await connection();
    await applyCommittedMigrations(client, databaseName, folder);
    const journalPath = join(folder, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const nextIndex = journal.entries.length;
    const nextTag = `${String(nextIndex).padStart(4, "0")}_failure`;
    const nextTimestamp = journal.entries.at(-1).when + 1;
    journal.entries.push({
      idx: nextIndex,
      version: "7",
      when: nextTimestamp,
      tag: nextTag,
      breakpoints: true,
    });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(
      join(folder, `${nextTag}.sql`),
      "CREATE TABLE rollback_probe (id integer);--> statement-breakpoint\nSELECT 'synthetic-private-database-detail'::integer;",
    );
    const failure = await applyCommittedMigrations(client, databaseName, folder).catch(
      (error) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("Database error details are withheld");
    expect(String(failure)).not.toContain("synthetic-private-database-detail");
    expect(failure).not.toHaveProperty("cause");
    expect(
      (await client.query("SELECT to_regclass('rollback_probe') AS probe")).rows[0].probe,
    ).toBeNull();
    expect(
      (await client.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations"))
        .rows[0].count,
    ).toBe(committedCount);
    const other = await connection();
    expect(
      (await other.query("SELECT pg_try_advisory_lock($1, $2) AS locked", [...migrationLock]))
        .rows[0].locked,
    ).toBe(true);
    await other.query("SELECT pg_advisory_unlock($1, $2)", [...migrationLock]);
  });
});
