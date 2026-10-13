import { expect, it } from "vitest";
import { migrateDatabase } from "./migrate.js";
import { seedDatabase, seedIds } from "./seed.js";
import { createTestDatabase } from "./testing.js";

it("normal initialization seeds only Keybank and preserves application edits on repeat", async () => {
  const database = await createTestDatabase();
  try {
    await seedDatabase(database.connectionString);
    expect((await database.pool.query("SELECT id, slug, name FROM banks")).rows).toEqual([
      { id: seedIds.bankA, slug: "keybank", name: "Keybank" },
    ]);
    await database.pool.query(
      "UPDATE applications SET purpose = 'Preserve this edit' WHERE id = $1",
      [seedIds.applicationSmall],
    );
    await migrateDatabase(database.connectionString);
    await seedDatabase(database.connectionString);
    expect(
      (
        await database.pool.query("SELECT purpose FROM applications WHERE id = $1", [
          seedIds.applicationSmall,
        ])
      ).rows[0].purpose,
    ).toBe("Preserve this edit");
    expect(
      (await database.pool.query("SELECT count(*)::int AS count FROM banks")).rows[0].count,
    ).toBe(1);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM bank_memberships WHERE bank_id <> $1",
          [seedIds.bankA],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await database.cleanup();
  }
});
