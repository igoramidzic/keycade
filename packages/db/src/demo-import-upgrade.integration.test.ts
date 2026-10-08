import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, it } from "vitest";
import { assertSchemaReady, migrateDatabase, migrationsFolder } from "./migrate.js";
import { seedIds as ids, seedDatabase } from "./seed.js";
import { createTestDatabase } from "./testing.js";

it("adds nullable demo recipe manifests without altering existing evidence, applications or grants and repeats safely", async () => {
  const folder = await mkdtemp(join(tmpdir(), "keycade-before-demo-import-"));
  const database = await createTestDatabase(undefined, { migrate: false });
  try {
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx < 22);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    await Promise.all(
      journal.entries.map((entry) =>
        copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`)),
      ),
    );
    await migrate(database.db, { migrationsFolder: folder });
    await seedDatabase(database.connectionString);
    const documentId = randomUUID();
    const versionId = randomUUID();
    await database.pool.query(
      "INSERT INTO documents (id,bank_id,application_id,visibility,current_version,created_by_user_id) VALUES ($1,$2,$3,'shared',1,$4)",
      [documentId, ids.bankA, ids.applicationSmall, ids.borrower],
    );
    await database.pool.query(
      "INSERT INTO document_versions (id,bank_id,application_id,document_id,version,file_name,mime_type,size_bytes,sha256,storage_key,upload_state,uploaded_by_user_id,key_hash,payload_hash,expires_at,uploaded_at,scan_state) VALUES ($1,$2,$3,$4,1,'Legacy synthetic evidence.pdf','application/pdf',128,$5,$9,'uploaded',$6,$7,$8,now()+interval '1 hour',now(),'clean')",
      [
        versionId,
        ids.bankA,
        ids.applicationSmall,
        documentId,
        "a".repeat(64),
        ids.borrower,
        "b".repeat(64),
        "c".repeat(64),
        versionId,
      ],
    );
    const beforeVersions = (
      await database.pool.query("SELECT * FROM document_versions ORDER BY id")
    ).rows;
    const beforeDocuments = (await database.pool.query("SELECT * FROM documents ORDER BY id")).rows;
    const beforeApplications = (await database.pool.query("SELECT * FROM applications ORDER BY id"))
      .rows;
    const beforeParticipants = (
      await database.pool.query("SELECT * FROM application_participants ORDER BY id")
    ).rows;
    await migrateDatabase(database.connectionString);
    await assertSchemaReady(database.connectionString);
    expect((await database.pool.query("SELECT * FROM document_versions ORDER BY id")).rows).toEqual(
      beforeVersions.map((row) => ({ ...row, demo_import_fixture: null })),
    );
    expect((await database.pool.query("SELECT * FROM documents ORDER BY id")).rows).toEqual(
      beforeDocuments,
    );
    expect((await database.pool.query("SELECT * FROM applications ORDER BY id")).rows).toEqual(
      beforeApplications,
    );
    expect(
      (await database.pool.query("SELECT * FROM application_participants ORDER BY id")).rows,
    ).toEqual(beforeParticipants);
    await migrateDatabase(database.connectionString);
    await seedDatabase(database.connectionString);
    expect((await database.pool.query("SELECT * FROM document_versions ORDER BY id")).rows).toEqual(
      beforeVersions.map((row) => ({ ...row, demo_import_fixture: null })),
    );
    expect((await database.pool.query("SELECT * FROM documents ORDER BY id")).rows).toEqual(
      beforeDocuments,
    );
    expect((await database.pool.query("SELECT * FROM applications ORDER BY id")).rows).toEqual(
      beforeApplications,
    );
  } finally {
    await database.cleanup();
    await rm(folder, { recursive: true, force: true });
  }
});
