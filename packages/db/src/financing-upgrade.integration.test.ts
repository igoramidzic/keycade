import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, it } from "vitest";
import { financingPolicyFixtures } from "./financing-fixtures.js";
import { assertSchemaReady, migrateDatabase, migrationsFolder } from "./migrate.js";
import { seedIds as ids, seedDatabase } from "./seed.js";
import { createTestDatabase, seedHistoricalFixtures } from "./testing.js";

const originals = [
  "banks",
  "loan_products",
  "applications",
  "application_setups",
  "application_submissions",
  "application_decisions",
  "product_closing_policies",
  "application_closing_packages",
  "closing_commands",
  "funding_records",
  "loan_accounts",
] as const;
const added = ["financing_product_policies", "financing_facilities", "legacy_facility_links"];
const key = (table: string) => (table === "application_setups" ? "application_id" : "id");

it("maps legacy applications at every stage to one legacy facility without rewriting their records", async () => {
  const folder = await mkdtemp(join(tmpdir(), "keylend-before-financing-"));
  const database = await createTestDatabase(undefined, { migrate: false });
  const query = (text: string, values: unknown[] = []) => database.pool.query(text, values);
  try {
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const financingMigration = journal.entries.find((entry) => entry.idx === 26);
    if (!financingMigration) throw new Error("Expected the financing migration.");
    journal.entries = journal.entries.filter((entry) => entry.idx < 26);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    await Promise.all(
      journal.entries.map((entry) =>
        copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`)),
      ),
    );
    await migrate(database.db, { migrationsFolder: folder });
    await seedHistoricalFixtures(database);

    // Legacy single-product applications at each lifecycle stage, using only pre-L01 columns.
    const control = randomUUID();
    const business = randomUUID();
    const priorProduct = randomUUID();
    const [submitted, approved, closing, funded, unproduct] = Array.from({ length: 5 }, () =>
      randomUUID(),
    ) as [string, string, string, string, string];
    await query(
      "INSERT INTO banks (id, slug, name, synthetic) VALUES ($1, 'non-synthetic-control', 'Non-synthetic control', false)",
      [control],
    );
    await query(
      "INSERT INTO businesses (id, bank_id, legal_name, synthetic) VALUES ($1, $2, 'Synthetic Funded Workshop', true)",
      [business, ids.bankA],
    );
    await query(
      `INSERT INTO loan_products (id, bank_id, slug, name, version, minimum_amount, maximum_amount, active, synthetic)
       VALUES ($1, $2, 'business-credit', 'Synthetic Business Credit (prior version)', 2, 10000, 7500000, false, true)`,
      [priorProduct, ids.bankA],
    );
    for (const [id, status, product, amount] of [
      [submitted, "submitted", ids.productA, "25000.00"],
      [approved, "approved", priorProduct, "30000.00"],
      [closing, "closing", ids.productA, "40000.00"],
      [funded, "funded", ids.productA, "50000.00"],
      [unproduct, "draft", null, null],
    ] as const) {
      await query(
        `INSERT INTO applications (id, bank_id, business_id, business_name, contact_id, product_id, requested_amount, source, status, revision, synthetic)
         VALUES ($1, $2, $3, 'Synthetic Funded Workshop', $4, $5, $6, 'seed', $7, 5, true)`,
        [id, ids.bankA, business, ids.contactA, product, amount, status],
      );
      await query(
        `INSERT INTO application_setups (application_id, bank_id, current_step, completed_steps, completed_at, completed_by_user_id)
         VALUES ($1, $2, 'review', ARRAY['business_name']::text[], $3, $4)`,
        [
          id,
          ids.bankA,
          status === "draft" ? null : "2026-10-01",
          status === "draft" ? null : ids.borrower,
        ],
      );
    }
    const submissions = new Map<string, string>();
    const decisions = new Map<string, string>();
    for (const id of [submitted, approved, closing, funded]) {
      const submission = randomUUID();
      submissions.set(id, submission);
      await query(
        `INSERT INTO application_submissions (id, bank_id, application_id, sequence, application_revision, submitted_by_user_id, snapshot)
         VALUES ($1, $2, $3, 1, 2, $4, $5)`,
        [
          submission,
          ids.bankA,
          id,
          ids.borrower,
          {
            facts: { productName: "Synthetic Business Credit" },
            materialFingerprint: "e".repeat(64),
            references: {},
          },
        ],
      );
    }
    for (const id of [approved, closing, funded]) {
      const decision = randomUUID();
      decisions.set(id, decision);
      await query(
        `INSERT INTO application_decisions (id, bank_id, application_id, submission_id, application_revision, outcome, reason_code, approved_amount, decided_by_user_id, evidence)
         VALUES ($1, $2, $3, $4, 3, 'approved', 'demo_criteria_met', 10000, $5, '{}')`,
        [decision, ids.bankA, id, submissions.get(id), ids.officerA],
      );
    }
    const policy = randomUUID();
    await query(
      `INSERT INTO product_closing_policies (id, bank_id, product_id, version, amount_policy, conditions)
       VALUES ($1, $2, $3, 1, 'exact_approved_amount', '[]')`,
      [policy, ids.bankA, ids.productA],
    );
    const packages = new Map<string, string>();
    for (const id of [closing, funded]) {
      const pkg = randomUUID();
      packages.set(id, pkg);
      await query(
        `INSERT INTO application_closing_packages (id, bank_id, application_id, decision_id, submission_id, policy_id, policy_version, amount_policy, terms, condition_templates, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, 1, 'exact_approved_amount', $7, '[]', $8)`,
        [
          pkg,
          ids.bankA,
          id,
          decisions.get(id),
          submissions.get(id),
          policy,
          { approvedAmount: "10000.00" },
          ids.officerA,
        ],
      );
      await query(
        `INSERT INTO closing_commands (bank_id, application_id, package_id, idempotency_key, actor_user_id, action, payload_hash, application_revision)
         VALUES ($1, $2, $3, $4, $5, 'start', $6, 4)`,
        [ids.bankA, id, pkg, randomUUID(), ids.officerA, "f".repeat(64)],
      );
    }
    const fundingRecord = randomUUID();
    const account = randomUUID();
    await query(
      `INSERT INTO funding_records (id, bank_id, application_id, package_id, decision_id, approved_amount, funded_amount, funded_on, reference, evidence, recorded_by_user_id)
       VALUES ($1, $2, $3, $4, $5, 10000, 10000, '2026-10-02', 'DEMO-LEGACY', '{}', $6)`,
      [fundingRecord, ids.bankA, funded, packages.get(funded), decisions.get(funded), ids.officerA],
    );
    await query(
      `INSERT INTO loan_accounts (id, bank_id, application_id, business_id, funding_record_id, terms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [account, ids.bankA, funded, business, fundingRecord, { approvedAmount: "10000.00" }],
    );
    await query(
      `INSERT INTO closing_commands (bank_id, application_id, package_id, account_id, idempotency_key, actor_user_id, action, payload_hash, application_revision)
       VALUES ($1, $2, $3, $4, $5, $6, 'fund', $7, 5)`,
      [
        ids.bankA,
        funded,
        packages.get(funded),
        account,
        randomUUID(),
        ids.officerA,
        "f".repeat(64),
      ],
    );

    const read = async (tables: readonly string[]) =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async (table) => [
            table,
            (await query(`SELECT * FROM ${table} ORDER BY ${key(table)}`)).rows,
          ]),
        ),
      ) as Record<string, Record<string, unknown>[]>;
    const before = await read(originals);
    await expect(assertSchemaReady(database.connectionString)).rejects.toThrow("pnpm db:migrate");
    await migrateDatabase(database.connectionString);
    await assertSchemaReady(database.connectionString);

    const expectOriginals = async () => {
      const after = await read(originals);
      for (const table of originals)
        expect(after[table], table).toEqual(
          table === "applications"
            ? before[table]?.map((row) => ({ ...row, financing_mode: "legacy" }))
            : before[table],
        );
    };
    await expectOriginals();
    const applications = before.applications ?? [];
    const facilities = (await query("SELECT * FROM financing_facilities ORDER BY application_id"))
      .rows;
    expect(facilities).toHaveLength(applications.length);
    for (const application of applications)
      expect(facilities.find((f) => f.application_id === application.id)).toMatchObject({
        bank_id: application.bank_id,
        origin: "legacy",
        ordinal: 1,
        legacy_product_id: application.product_id,
        introduced_in_structure_id: null,
      });
    expect(facilities.find((f) => f.application_id === approved)?.legacy_product_id).toBe(
      priorProduct,
    );
    const facilityOf = (applicationId: string) =>
      facilities.find((f) => f.application_id === applicationId)?.id;
    const links = (await query("SELECT * FROM legacy_facility_links")).rows;
    expect(links).toHaveLength(7);
    for (const id of [approved, closing, funded])
      expect(links).toContainEqual(
        expect.objectContaining({ decision_id: decisions.get(id), facility_id: facilityOf(id) }),
      );
    for (const id of [closing, funded])
      expect(links).toContainEqual(
        expect.objectContaining({
          closing_package_id: packages.get(id),
          facility_id: facilityOf(id),
        }),
      );
    expect(links).toContainEqual(
      expect.objectContaining({
        funding_record_id: fundingRecord,
        facility_id: facilityOf(funded),
      }),
    );
    expect(links).toContainEqual(
      expect.objectContaining({ loan_account_id: account, facility_id: facilityOf(funded) }),
    );
    for (const table of [
      "financing_request_revisions",
      "financing_structure_revisions",
      "financing_facility_versions",
      "financing_commands",
    ])
      expect((await query(`SELECT * FROM ${table}`)).rows, table).toEqual([]);

    // Version 1 policies exist only for synthetic banks and match the seeded fixtures exactly.
    const policies = (
      await query(
        `SELECT bank_id, family, variant, version, security, minimum_principal::text AS "minimumPrincipal",
          maximum_principal::text AS "maximumPrincipal", minimum_basis AS "minimumBasis", maximum_basis AS "maximumBasis",
          aggregate_maximum::text AS "aggregateMaximum", aggregate_basis AS "aggregateBasis", catalog_version AS "catalogVersion",
          effective_on::text AS "effectiveOn", expires_on::text AS "expiresOn", review_due_on::text AS "reviewDueOn",
          sources, configuration_note AS "configurationNote", active, synthetic
         FROM financing_product_policies ORDER BY bank_id, variant`,
      )
    ).rows;
    for (const bankId of [ids.bankA, ids.bankB])
      expect(
        policies
          .filter((row) => row.bank_id === bankId)
          .map(({ bank_id: _, active, synthetic, ...row }) => {
            expect({ active, synthetic }).toEqual({ active: true, synthetic: true });
            return row;
          }),
      ).toEqual([...financingPolicyFixtures].sort((a, b) => a.variant.localeCompare(b.variant)));
    expect(policies.filter((row) => row.bank_id === control)).toEqual([]);

    // Repeat migration, a replay of the backfill statements and repeated seeding change nothing.
    const migrated = await read(added);
    await migrateDatabase(database.connectionString);
    await expectOriginals();
    expect(await read(added)).toEqual(migrated);
    const sql = await readFile(join(migrationsFolder, `${financingMigration.tag}.sql`), "utf8");
    const backfillAt = sql.indexOf('INSERT INTO "financing_product_policies"');
    if (backfillAt < 0) throw new Error("Expected the policy and legacy backfill statements.");
    for (const statement of sql.slice(backfillAt).split("--> statement-breakpoint"))
      if (statement.trim()) await query(statement);
    await expectOriginals();
    expect(await read(added)).toEqual(migrated);
    await seedDatabase(database.connectionString, { isolationFixtures: true });
    const seeded = await read([...originals, ...added]);
    const expected: Record<string, Record<string, unknown>[] | undefined> = {
      ...before,
      applications: before.applications?.map((row) => ({ ...row, financing_mode: "legacy" })),
      ...migrated,
    };
    // Seeding only adds its own missing fixtures; existing rows and mappings are untouched.
    for (const [table, rows = []] of Object.entries(expected))
      expect(
        seeded[table]?.filter((row) => rows.some((prior) => prior[key(table)] === row[key(table)])),
        table,
      ).toEqual(rows);
    await seedDatabase(database.connectionString, { isolationFixtures: true });
    expect(await read([...originals, ...added])).toEqual(seeded);

    // The funded legacy application can never be converted to the structured mode.
    await expect(
      query("UPDATE applications SET financing_mode = 'structured' WHERE id = $1", [funded]),
    ).rejects.toThrow(/cannot change financing mode/);
  } finally {
    await database.cleanup();
    await rm(folder, { recursive: true, force: true });
  }
});
