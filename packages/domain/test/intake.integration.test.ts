import { randomUUID } from "node:crypto";
import { banks, loanProducts } from "@keycade/db";
import { createTestDatabase } from "@keycade/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPublicIntake } from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const bankId = randomUUID();
const otherBankId = randomUUID();
const latestProductId = randomUUID();
beforeAll(async () => {
  database = await createTestDatabase();
  await database.db.insert(banks).values([
    { id: bankId, slug: "catalog-bank", name: "Synthetic Catalog Bank", synthetic: true },
    { id: otherBankId, slug: "other-bank", name: "Other Synthetic Bank", synthetic: true },
    { slug: "empty-bank", name: "Empty Synthetic Bank", synthetic: true },
  ]);
  const product = {
    bankId,
    slug: "business-loan",
    name: "Business loan",
    minimumAmount: "10000.00",
    maximumAmount: "7500000.00",
    synthetic: true,
  };
  await database.db.insert(loanProducts).values([
    { ...product, version: 1 },
    { ...product, id: latestProductId, version: 2 },
    { ...product, version: 3, active: false },
    { ...product, slug: "retired-loan", active: false },
    { ...product, bankId: otherBankId, version: 4 },
  ]);
}, 30_000);
afterAll(async () => database?.cleanup());

describe("public intake product configuration", () => {
  it("returns only the latest active version per bank and exact product limits", async () => {
    expect(await readPublicIntake(database.db, { bankSlug: "catalog-bank" })).toEqual({
      bank: { id: bankId, slug: "catalog-bank", name: "Synthetic Catalog Bank", synthetic: true },
      products: [
        {
          id: latestProductId,
          slug: "business-loan",
          name: "Business loan",
          version: 2,
          minimumAmount: "10000.00",
          maximumAmount: "7500000.00",
          currency: "USD",
        },
      ],
    });
  });

  it("distinguishes an empty catalog from an unknown bank without exposing private records", async () => {
    expect((await readPublicIntake(database.db, { bankSlug: "empty-bank" })).products).toEqual([]);
    await expect(readPublicIntake(database.db, { bankSlug: "missing-bank" })).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Resource not found.",
      },
    );
    const counts = await database.pool.query(
      "SELECT (SELECT count(*)::int FROM applications) AS applications, (SELECT count(*)::int FROM applicant_contacts) AS contacts, (SELECT count(*)::int FROM audit_events) AS audits",
    );
    expect(counts.rows[0]).toEqual({ applications: 0, contacts: 0, audits: 0 });
  });

  it("rejects malformed slugs and caller-supplied tenant or product overrides", async () => {
    for (const input of [
      { bankSlug: "Catalog Bank" },
      { bankSlug: "a".repeat(81) },
      { bankSlug: "catalog-bank", bankId: otherBankId },
      { bankSlug: "catalog-bank", productId: latestProductId },
    ])
      await expect(readPublicIntake(database.db, input)).rejects.toMatchObject({
        code: "INVALID_INPUT",
        statusCode: 400,
      });
  });
});
