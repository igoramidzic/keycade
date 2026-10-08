import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, it } from "vitest";
import { assertSchemaReady, migrateDatabase, migrationsFolder } from "./migrate.js";
import { seedIds as ids, seedDatabase } from "./seed.js";
import { createTestDatabase } from "./testing.js";

it("upgrades populated pre-workspace evidence without inventing reviewed facts or changing immutable decisions", async () => {
  const folder = await mkdtemp(join(tmpdir(), "keycade-before-document-workspace-"));
  const database = await createTestDatabase(undefined, { migrate: false });
  try {
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx < 23);
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
    const runId = randomUUID();
    const submissionId = randomUUID();
    const fixture = {
      recipeId: "business-tax-return-2023",
      recipeVersion: 1,
      businessName: "Synthetic Cedar Workshop",
      applicationRevision: 1,
    };
    await database.pool.query(
      "INSERT INTO documents (id,bank_id,application_id,visibility,current_version,created_by_user_id) VALUES ($1,$2,$3,'shared',1,$4)",
      [documentId, ids.bankA, ids.applicationSmall, ids.borrower],
    );
    await database.pool.query(
      "INSERT INTO document_versions (id,bank_id,application_id,document_id,version,file_name,mime_type,size_bytes,sha256,storage_key,upload_state,uploaded_by_user_id,key_hash,payload_hash,expires_at,uploaded_at,scan_state,demo_import_fixture) VALUES ($1,$2,$3,$4,1,'Legacy synthetic tax evidence.pdf','application/pdf',128,$5,$10,'uploaded',$6,$7,$8,now()+interval '1 hour',now(),'clean',$9)",
      [
        versionId,
        ids.bankA,
        ids.applicationSmall,
        documentId,
        "a".repeat(64),
        ids.borrower,
        "b".repeat(64),
        "c".repeat(64),
        fixture,
        versionId,
      ],
    );
    const originalResult = {
      provider: "keycade-document-interpretation-v1",
      simulated: true,
      versionId,
      runId,
      category: "tax",
      confidence: 0.99,
      needsReview: false,
      extractedFields: [{ key: "revenue", label: "Revenue", kind: "money", value: "1200000.00" }],
      demoImportFixture: fixture,
      completedAt: "2026-10-08T12:00:00.000Z",
    };
    await database.pool.query(
      "INSERT INTO document_processing_runs (id,bank_id,application_id,version_id,generation,state,attempts,result,request_id) VALUES ($1,$2,$3,$4,1,'classified',1,$5,'legacy-workspace-upgrade')",
      [runId, ids.bankA, ids.applicationSmall, versionId, originalResult],
    );
    await database.pool.query(
      "INSERT INTO document_category_overrides (bank_id,application_id,version_id,revision,category,reason,actor_user_id) VALUES ($1,$2,$3,1,'financial_statement','Synthetic original category review',$4)",
      [ids.bankA, ids.applicationSmall, versionId, ids.officerA],
    );
    await database.pool.query(
      "INSERT INTO application_submissions (id,bank_id,application_id,sequence,application_revision,submitted_by_user_id,snapshot) VALUES ($1,$2,$3,1,1,$4,$5)",
      [
        submissionId,
        ids.bankA,
        ids.applicationSmall,
        ids.borrower,
        {
          facts: { businessName: "Synthetic historical name", requestedAmount: "10000.00" },
          materialFingerprint: "d".repeat(64),
          references: { documents: [{ documentId, versionId, runId }] },
        },
      ],
    );
    await database.pool.query(
      "INSERT INTO application_decisions (bank_id,application_id,submission_id,application_revision,outcome,reason_code,approved_amount,decided_by_user_id,evidence) VALUES ($1,$2,$3,2,'approved','demo_criteria_met','10000.00',$4,$5)",
      [
        ids.bankA,
        ids.applicationSmall,
        submissionId,
        ids.officerA,
        { submissionId, materialFingerprint: "d".repeat(64), documents: [{ versionId, runId }] },
      ],
    );
    const tables = [
      "applications",
      "application_participants",
      "documents",
      "document_versions",
      "document_processing_runs",
      "document_category_overrides",
      "application_submissions",
      "application_decisions",
    ] as const;
    const before = await Promise.all(
      tables.map(
        async (table) => (await database.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows,
      ),
    );
    await expect(assertSchemaReady(database.connectionString)).rejects.toThrow("pnpm db:migrate");
    for (let attempt = 0; attempt < 2; attempt++) {
      await migrateDatabase(database.connectionString);
      await assertSchemaReady(database.connectionString);
      await seedDatabase(database.connectionString);
      for (const [index, table] of tables.entries())
        expect((await database.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows).toEqual(
          before[index],
        );
      for (const table of [
        "document_metadata_revisions",
        "financial_fact_reviews",
        "financial_fact_commands",
      ])
        expect((await database.pool.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
    }
  } finally {
    await database.cleanup();
    await rm(folder, { recursive: true, force: true });
  }
});
