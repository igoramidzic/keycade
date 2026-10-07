import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, it } from "vitest";
import { assertSchemaReady, migrateDatabase, migrationsFolder } from "./migrate.js";
import { seedIds } from "./seed.js";
import { createTestDatabase } from "./testing.js";

it("adds closing policies to every existing synthetic business-credit version without changing applications", async () => {
  const folder = await mkdtemp(join(tmpdir(), "keycade-before-closing-"));
  const database = await createTestDatabase(undefined, { migrate: false });
  try {
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const closingMigration = journal.entries.find((entry) => entry.idx === 19);
    if (!closingMigration) throw new Error("Expected additive closing migration.");
    journal.entries = journal.entries.filter((entry) => entry.idx < 19);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    await Promise.all(
      journal.entries.map((entry) =>
        copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`)),
      ),
    );
    await migrate(database.db, { migrationsFolder: folder });
    await seedHistoricalDatabase(database);
    const secondVersion = randomUUID(),
      thirdVersion = randomUUID();
    await database.pool.query(
      `INSERT INTO loan_products (id, bank_id, slug, name, version, minimum_amount, maximum_amount, active, synthetic)
       VALUES ($1,$3,'business-credit','Synthetic prior product version',2,10000,7500000,false,true),
              ($2,$3,'business-credit','Synthetic current product version',3,10000,7500000,true,true),
              ($4,$3,'business-credit','Non-synthetic control product',4,10000,7500000,true,false),
              ($5,$3,'other-credit','Synthetic unrelated product',1,10000,7500000,true,true)`,
      [secondVersion, thirdVersion, seedIds.bankA, randomUUID(), randomUUID()],
    );
    await database.pool.query(
      "UPDATE applications SET status = 'approved', revision = 8 WHERE id = $1",
      [seedIds.applicationSmall],
    );
    await database.pool.query(
      "UPDATE applications SET status = 'funded', revision = 11 WHERE id = $1",
      [seedIds.applicationOtherBank],
    );
    const readApplications = () => database.pool.query("SELECT * FROM applications ORDER BY id");
    const readSetups = () =>
      database.pool.query("SELECT * FROM application_setups ORDER BY application_id");
    const beforeApplications = (await readApplications()).rows;
    const beforeSetups = (await readSetups()).rows;
    const beforeProducts = (await database.pool.query("SELECT * FROM loan_products ORDER BY id"))
      .rows;
    await migrateDatabase(database.connectionString);
    await assertSchemaReady(database.connectionString);
    const policies = (
      await database.pool.query("SELECT * FROM product_closing_policies ORDER BY product_id")
    ).rows;
    expect(policies.map((policy) => policy.product_id).sort()).toEqual(
      [seedIds.productA, seedIds.productB, secondVersion, thirdVersion].sort(),
    );
    for (const policy of policies) {
      expect(policy).toMatchObject({ version: 1, amount_policy: "exact_approved_amount" });
      expect(policy.conditions).toEqual([
        expect.objectContaining({ key: "funding-confirmation", kind: "task", required: true }),
        expect.objectContaining({ key: "closing-agreement", kind: "signature", required: true }),
      ]);
    }
    expect((await readApplications()).rows).toEqual(beforeApplications);
    expect((await readSetups()).rows).toEqual(beforeSetups);
    expect((await database.pool.query("SELECT * FROM loan_products ORDER BY id")).rows).toEqual(
      beforeProducts,
    );
    for (const table of [
      "application_closing_packages",
      "closing_conditions",
      "funding_records",
      "loan_accounts",
    ])
      expect((await database.pool.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
    await migrateDatabase(database.connectionString);
    // The fixture bootstrap itself is also repeatable, beyond the migrator's journal no-op.
    const sql = await readFile(join(migrationsFolder, `${closingMigration.tag}.sql`), "utf8");
    const insertAt = sql.indexOf('INSERT INTO "product_closing_policies"');
    if (insertAt < 0) throw new Error("Expected closing policy bootstrap.");
    await database.pool.query(sql.slice(insertAt));
    expect(
      (await database.pool.query("SELECT * FROM product_closing_policies ORDER BY product_id"))
        .rows,
    ).toEqual(policies);
    expect((await readApplications()).rows).toEqual(beforeApplications);
    expect((await readSetups()).rows).toEqual(beforeSetups);
  } finally {
    await database.cleanup();
    await rm(folder, { recursive: true, force: true });
  }
});

// Deliberately use only the SQL columns present in migration 0004. Importing the current
// ORM/seed would silently couple historical fixtures to later schema additions.
async function seedHistoricalDatabase(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  await database.pool.query(
    "INSERT INTO banks (id, slug, name, synthetic) VALUES ($1,'bank-a','Synthetic Historical A',true), ($2,'bank-b','Synthetic Historical B',true)",
    [seedIds.bankA, seedIds.bankB],
  );
  await database.pool.query(
    `INSERT INTO users (id,email,display_name,email_verified_at,synthetic) VALUES
    ($1,'borrower@example.test','Synthetic Historical Borrower','2026-01-01',true),
    ($2,'officer-a@example.test','Synthetic Historical Officer','2026-01-01',true),
    ($3,'adviser@example.test','Synthetic Historical Adviser','2026-01-01',true),
    ($4,'revoked-owner@example.test','Synthetic Historical Revoked Owner','2026-01-01',true)`,
    [seedIds.borrower, seedIds.officerA, seedIds.adviser, seedIds.revokedOwner],
  );
  await database.pool.query(
    "INSERT INTO bank_memberships (bank_id,user_id,role,synthetic) VALUES ($1,$2,'officer',true)",
    [seedIds.bankA, seedIds.officerA],
  );
  await database.pool.query(
    "INSERT INTO applicant_contacts (id,bank_id,email,user_id,synthetic) VALUES ($1,$2,'borrower@example.test',$3,true)",
    [seedIds.contactA, seedIds.bankA, seedIds.borrower],
  );
  await database.pool.query(
    `INSERT INTO loan_products (id,bank_id,slug,name,minimum_amount,maximum_amount,synthetic) VALUES
    ($1,$2,'business-credit','Synthetic Business Credit',10000,7500000,true),
    ($3,$4,'business-credit','Synthetic Business Credit',10000,7500000,true)`,
    [seedIds.productA, seedIds.bankA, seedIds.productB, seedIds.bankB],
  );
  await database.pool.query(
    `INSERT INTO applications (id,bank_id,product_id,source,status,business_name,synthetic) VALUES
    ($1,$2,$3,'seed','collecting_information','Synthetic Historical Business',true),
    ($4,$2,$3,'seed','draft',NULL,true),
    ($5,$6,$7,'seed','draft','Synthetic Other Bank Business',true)`,
    [
      seedIds.applicationSmall,
      seedIds.bankA,
      seedIds.productA,
      seedIds.applicationEmpty,
      seedIds.applicationOtherBank,
      seedIds.bankB,
      seedIds.productB,
    ],
  );
  await database.pool.query(
    `INSERT INTO application_setups (application_id,bank_id,current_step,completed_steps,skipped_steps,completed_at,completed_by_user_id) VALUES
    ($1,$2,'review',ARRAY['business_name','product','amount','purpose'],ARRAY['industry'],'2026-01-01',$3),
    ($4,$2,'business_name',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL),
    ($5,$6,'business_name',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL)`,
    [
      seedIds.applicationSmall,
      seedIds.bankA,
      seedIds.borrower,
      seedIds.applicationEmpty,
      seedIds.applicationOtherBank,
      seedIds.bankB,
    ],
  );
  await database.pool.query(
    `INSERT INTO application_participants (bank_id,application_id,user_id,role,scope,revoked_at,synthetic) VALUES
    ($1,$2,$3,'applicant_admin','full',NULL,true),
    ($1,$2,$4,'adviser','assigned',NULL,true),
    ($1,$2,$5,'owner','assigned','2026-01-01',true)`,
    [
      seedIds.bankA,
      seedIds.applicationSmall,
      seedIds.borrower,
      seedIds.adviser,
      seedIds.revokedOwner,
    ],
  );
}

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

it("assigns the fixed bank product to legacy drafts and resumes past product selection without altering completed applications", async () => {
  const folder = await mkdtemp(join(tmpdir(), "keycade-before-fixed-product-"));
  const database = await createTestDatabase(undefined, { migrate: false });
  try {
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx < 5);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    await Promise.all(
      journal.entries.map((entry) =>
        copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`)),
      ),
    );
    await migrate(database.db, { migrationsFolder: folder });
    await seedHistoricalDatabase(database);
    await database.pool.query(
      "UPDATE applications SET product_id = NULL, business_name = 'Synthetic saved draft', revision = 7 WHERE id = $1",
      [seedIds.applicationEmpty],
    );
    await database.pool.query(
      "UPDATE application_setups SET current_step = 'product', revision = 7, completed_steps = ARRAY['business_name']::text[] WHERE application_id = $1",
      [seedIds.applicationEmpty],
    );
    const read = () =>
      database.pool.query(`SELECT a.id, a.bank_id, a.product_id, a.business_name, a.requested_amount, a.revision,
      s.revision AS setup_revision, s.current_step, s.completed_steps, s.completed_at, s.completed_by_user_id
      FROM applications a JOIN application_setups s ON s.application_id = a.id ORDER BY a.id`);
    const before = (await read()).rows;
    await migrateDatabase(database.connectionString);
    const after = (await read()).rows;
    expect(after.find((row) => row.id === seedIds.applicationEmpty)).toMatchObject({
      bank_id: seedIds.bankA,
      product_id: seedIds.productA,
      business_name: "Synthetic saved draft",
      requested_amount: null,
      revision: 8,
      setup_revision: 8,
      current_step: "amount",
      completed_steps: ["business_name"],
      completed_at: null,
      completed_by_user_id: null,
    });
    expect(after.filter((row) => row.id !== seedIds.applicationEmpty)).toEqual(
      before.filter((row) => row.id !== seedIds.applicationEmpty),
    );
    await migrateDatabase(database.connectionString);
    expect((await read()).rows).toEqual(after);
  } finally {
    await database.cleanup();
    await rm(folder, { recursive: true, force: true });
  }
});

it("adds internal staff notes without altering pre-T10 applications and enforces tenant references", async () => {
  const folder = await mkdtemp(join(tmpdir(), "keycade-before-staff-workspace-"));
  const database = await createTestDatabase(undefined, { migrate: false });
  try {
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx < 6);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    await Promise.all(
      journal.entries.map((entry) =>
        copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`)),
      ),
    );
    await migrate(database.db, { migrationsFolder: folder });
    await seedHistoricalDatabase(database);
    const before = (await database.pool.query("SELECT * FROM applications ORDER BY id")).rows;
    await migrateDatabase(database.connectionString);
    await assertSchemaReady(database.connectionString);
    expect((await database.pool.query("SELECT * FROM applications ORDER BY id")).rows).toEqual(
      before,
    );
    expect((await database.pool.query("SELECT * FROM staff_notes")).rows).toEqual([]);
    await database.pool.query(
      "INSERT INTO staff_notes (bank_id, application_id, body, author_user_id, updated_by_user_id) VALUES ($1, $2, 'Synthetic retained note', $3, $3)",
      [seedIds.bankA, seedIds.applicationSmall, seedIds.officerA],
    );
    await expect(
      database.pool.query(
        "INSERT INTO staff_notes (bank_id, application_id, body, author_user_id, updated_by_user_id) VALUES ($1, $2, 'Synthetic invalid reference', $3, $3)",
        [seedIds.bankA, seedIds.applicationOtherBank, seedIds.officerA],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await migrateDatabase(database.connectionString);
    expect((await database.pool.query("SELECT body FROM staff_notes")).rows).toEqual([
      { body: "Synthetic retained note" },
    ]);
  } finally {
    await database.cleanup();
    await rm(folder, { recursive: true, force: true });
  }
});

it("upgrades pre-T11 grants and auth deliveries without granting additional access", async () => {
  const folder = await mkdtemp(join(tmpdir(), "keycade-before-participants-"));
  const database = await createTestDatabase(undefined, { migrate: false });
  try {
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx < 7);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    await Promise.all(
      journal.entries.map((entry) =>
        copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`)),
      ),
    );
    await migrate(database.db, { migrationsFolder: folder });
    await seedHistoricalDatabase(database);
    const deliveryId = randomUUID();
    await database.pool.query(
      `INSERT INTO access_delivery_requests (id,bank_id,application_id,contact_id,portal,origin,return_path,expires_at,request_id)
      VALUES ($1,$2,$3,$4,'borrower','http://localhost:3001','/','2026-10-08', $5)`,
      [deliveryId, seedIds.bankA, seedIds.applicationSmall, seedIds.contactA, randomUUID()],
    );
    const tokenHash = "a".repeat(64);
    await database.pool.query(
      "INSERT INTO login_tokens (delivery_request_id,token_hash,expires_at) VALUES ($1,$2,'2026-10-08')",
      [deliveryId, tokenHash],
    );
    const beforeApplications = (await database.pool.query("SELECT * FROM applications ORDER BY id"))
      .rows;
    const beforeParticipants = (
      await database.pool.query("SELECT * FROM application_participants ORDER BY id")
    ).rows;
    const beforeDeliveries = (
      await database.pool.query("SELECT * FROM access_delivery_requests ORDER BY id")
    ).rows;
    const beforeTokens = (await database.pool.query("SELECT * FROM login_tokens ORDER BY id")).rows;
    await migrateDatabase(database.connectionString);
    await assertSchemaReady(database.connectionString);
    expect((await database.pool.query("SELECT * FROM applications ORDER BY id")).rows).toEqual(
      beforeApplications,
    );
    const afterParticipants = (
      await database.pool.query("SELECT * FROM application_participants ORDER BY id")
    ).rows;
    expect(afterParticipants).toEqual(
      beforeParticipants.map((row) => ({
        ...row,
        task_ids: [],
        document_ids: [],
        unassigned_at: null,
      })),
    );
    expect(
      afterParticipants.find((row) => row.user_id === seedIds.revokedOwner)?.revoked_at,
    ).toEqual(new Date("2026-01-01T00:00:00Z"));
    const afterDeliveries = (
      await database.pool.query("SELECT * FROM access_delivery_requests ORDER BY id")
    ).rows;
    expect(afterDeliveries).toEqual(
      beforeDeliveries.map((row) => ({ ...row, invitation_id: null })),
    );
    expect((await database.pool.query("SELECT * FROM login_tokens ORDER BY id")).rows).toEqual(
      beforeTokens,
    );
    for (const table of ["invitations", "business_relationships", "participant_commands"])
      expect((await database.pool.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
    await migrateDatabase(database.connectionString);
    expect(
      (await database.pool.query("SELECT * FROM application_participants ORDER BY id")).rows,
    ).toEqual(afterParticipants);
    expect(
      (await database.pool.query("SELECT * FROM access_delivery_requests ORDER BY id")).rows,
    ).toEqual(afterDeliveries);
  } finally {
    await database.cleanup();
    await rm(folder, { recursive: true, force: true });
  }
});
