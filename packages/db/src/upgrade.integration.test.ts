import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, it } from "vitest";
import { assertSchemaReady, migrateDatabase, migrationsFolder } from "./migrate.js";
import { createTestDatabase } from "./testing.js";

it("upgrades historical drafts and later lifecycle applications without inventing confirmation", async () => {
  const earlierMigrations = await mkdtemp(join(tmpdir(), "keycade-prior-migrations-"));
  const database = await createTestDatabase(undefined, { migrate: false });
  try {
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as {
      entries: { idx: number; tag: string }[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx < 4);
    await mkdir(join(earlierMigrations, "meta"));
    await writeFile(join(earlierMigrations, "meta/_journal.json"), JSON.stringify(journal));
    await Promise.all(
      journal.entries.map((entry) =>
        copyFile(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(earlierMigrations, `${entry.tag}.sql`),
        ),
      ),
    );
    await migrate(database.db, { migrationsFolder: earlierMigrations });

    const bankId = randomUUID();
    const businessId = randomUUID();
    const draftId = randomUUID();
    const collectingId = randomUUID();
    await database.pool.query(
      "INSERT INTO banks (id, slug, name, synthetic) VALUES ($1, 'upgrade-bank', 'Synthetic upgrade bank', true)",
      [bankId],
    );
    await database.pool.query(
      "INSERT INTO businesses (id, bank_id, legal_name, synthetic) VALUES ($1, $2, 'Synthetic historical business', true)",
      [businessId, bankId],
    );
    await database.pool.query(
      `INSERT INTO applications (id, bank_id, business_id, source, status, revision, synthetic, updated_at)
      VALUES ($1, $3, $4, 'seed', 'draft', 7, true, '2026-10-01T00:00:00Z'),
      ($2, $3, $4, 'seed', 'collecting_information', 9, true, '2026-10-02T00:00:00Z')`,
      [draftId, collectingId, bankId, businessId],
    );

    await migrateDatabase(database.connectionString);
    await assertSchemaReady(database.connectionString);
    const readMigrated = () =>
      database.pool.query(`SELECT a.id, a.status, a.business_name, a.demo_created,
      s.revision, s.definition_version, s.current_step, s.completed_steps, s.skipped_steps, s.completed_at, s.completed_by_user_id
      FROM applications a JOIN application_setups s ON s.application_id = a.id AND s.bank_id = a.bank_id ORDER BY a.id`);
    const first = await readMigrated();
    expect(first.rows).toHaveLength(2);
    expect(first.rows.find((row) => row.id === draftId)).toMatchObject({
      status: "draft",
      business_name: "Synthetic historical business",
      demo_created: false,
      revision: 7,
      definition_version: 1,
      current_step: "business_name",
      completed_steps: [],
      skipped_steps: [],
      completed_at: null,
      completed_by_user_id: null,
    });
    expect(first.rows.find((row) => row.id === collectingId)).toMatchObject({
      status: "collecting_information",
      business_name: "Synthetic historical business",
      demo_created: false,
      revision: 9,
      current_step: "review",
      completed_steps: ["business_name", "product", "amount", "purpose"],
      skipped_steps: ["industry"],
      completed_at: new Date("2026-10-02T00:00:00Z"),
      completed_by_user_id: null,
    });
    await migrateDatabase(database.connectionString);
    expect((await readMigrated()).rows).toEqual(first.rows);
  } finally {
    await database.cleanup();
    await rm(earlierMigrations, { recursive: true, force: true });
  }
});
