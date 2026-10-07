import { inArray } from "drizzle-orm";
import { createDatabase } from "./index.js";
import { normalizeMoney } from "./money.js";
import {
  applicantContacts,
  applicationParticipants,
  applicationSetups,
  applications,
  bankMemberships,
  banks,
  businesses,
  businessRelationships,
  loanProducts,
  users,
} from "./schema.js";

export const seedIds = {
  bankA: "10000000-0000-4000-8000-000000000001",
  bankB: "10000000-0000-4000-8000-000000000002",
  borrower: "20000000-0000-4000-8000-000000000001",
  officerA: "20000000-0000-4000-8000-000000000002",
  officerB: "20000000-0000-4000-8000-000000000003",
  adviser: "20000000-0000-4000-8000-000000000004",
  revokedOwner: "20000000-0000-4000-8000-000000000005",
  contactA: "30000000-0000-4000-8000-000000000001",
  businessA: "40000000-0000-4000-8000-000000000001",
  businessB: "40000000-0000-4000-8000-000000000002",
  businessOtherBank: "40000000-0000-4000-8000-000000000003",
  productA: "50000000-0000-4000-8000-000000000001",
  productB: "50000000-0000-4000-8000-000000000002",
  applicationSmall: "60000000-0000-4000-8000-000000000001",
  applicationLarge: "60000000-0000-4000-8000-000000000002",
  applicationUnshared: "60000000-0000-4000-8000-000000000003",
  applicationOtherBank: "60000000-0000-4000-8000-000000000004",
  applicationEmpty: "60000000-0000-4000-8000-000000000005",
  applicationSetupDraft: "60000000-0000-4000-8000-000000000006",
  applicationClosedDraft: "60000000-0000-4000-8000-000000000007",
  ownerRelationship: "70000000-0000-4000-8000-000000000001",
} as const;

/** Insert missing synthetic fixtures only. Never resets or overwrites user edits. */
export async function seedDatabase(connectionString: string): Promise<void> {
  const { db, pool } = createDatabase(connectionString);
  try {
    await db.transaction(async (tx) => {
      const verifiedAt = new Date("2026-01-01T00:00:00.000Z");
      await tx
        .insert(banks)
        .values([
          { id: seedIds.bankA, slug: "bank-a", name: "Synthetic Bank A", synthetic: true },
          { id: seedIds.bankB, slug: "bank-b", name: "Synthetic Bank B", synthetic: true },
        ])
        .onConflictDoNothing();
      await tx
        .insert(users)
        .values(
          [
            {
              id: seedIds.borrower,
              email: "borrower@example.test",
              displayName: "Synthetic Borrower",
            },
            {
              id: seedIds.officerA,
              email: "officer-a@example.test",
              displayName: "Synthetic Officer A",
            },
            {
              id: seedIds.officerB,
              email: "officer-b@example.test",
              displayName: "Synthetic Officer B",
            },
            {
              id: seedIds.adviser,
              email: "adviser@example.test",
              displayName: "Synthetic Restricted Adviser",
            },
            {
              id: seedIds.revokedOwner,
              email: "revoked-owner@example.test",
              displayName: "Synthetic Revoked Owner",
            },
          ].map((user) => ({ ...user, synthetic: true, emailVerifiedAt: verifiedAt })),
        )
        .onConflictDoNothing();
      await tx
        .insert(bankMemberships)
        .values([
          { bankId: seedIds.bankA, userId: seedIds.officerA, role: "admin", synthetic: true },
          { bankId: seedIds.bankB, userId: seedIds.officerB, role: "officer", synthetic: true },
        ])
        .onConflictDoNothing();
      await tx
        .insert(applicantContacts)
        .values({
          id: seedIds.contactA,
          bankId: seedIds.bankA,
          email: "borrower@example.test",
          userId: seedIds.borrower,
          synthetic: true,
        })
        .onConflictDoNothing();
      await tx
        .insert(businesses)
        .values(
          [
            { id: seedIds.businessA, bankId: seedIds.bankA, legalName: "Synthetic Cedar Workshop" },
            { id: seedIds.businessB, bankId: seedIds.bankA, legalName: "Synthetic Maple Supply" },
            {
              id: seedIds.businessOtherBank,
              bankId: seedIds.bankB,
              legalName: "Synthetic Birch Services",
            },
          ].map((business) => ({ ...business, synthetic: true })),
        )
        .onConflictDoNothing();
      await tx
        .insert(loanProducts)
        .values(
          [
            { id: seedIds.productA, bankId: seedIds.bankA },
            { id: seedIds.productB, bankId: seedIds.bankB },
          ].map((product) => ({
            ...product,
            slug: "business-credit",
            name: "Synthetic Business Credit",
            minimumAmount: normalizeMoney("10000"),
            maximumAmount: normalizeMoney("7500000"),
            synthetic: true,
          })),
        )
        .onConflictDoNothing();
      await tx
        .insert(applications)
        .values([
          {
            id: seedIds.applicationSmall,
            bankId: seedIds.bankA,
            businessId: seedIds.businessA,
            businessName: "Synthetic Cedar Workshop",
            contactId: seedIds.contactA,
            productId: seedIds.productA,
            requestedAmount: normalizeMoney("10000"),
            purpose: "Synthetic equipment purchase",
            source: "seed",
            status: "collecting_information",
            synthetic: true,
          },
          {
            id: seedIds.applicationLarge,
            bankId: seedIds.bankA,
            businessId: seedIds.businessB,
            businessName: "Synthetic Maple Supply",
            contactId: seedIds.contactA,
            productId: seedIds.productA,
            requestedAmount: normalizeMoney("5000000"),
            purpose: "Synthetic expansion",
            source: "seed",
            status: "collecting_information",
            synthetic: true,
          },
          {
            id: seedIds.applicationUnshared,
            bankId: seedIds.bankA,
            businessId: seedIds.businessA,
            businessName: "Synthetic Cedar Workshop",
            productId: seedIds.productA,
            requestedAmount: normalizeMoney("7500000"),
            purpose: "Synthetic separate request; no borrower grant",
            source: "seed",
            synthetic: true,
          },
          {
            id: seedIds.applicationOtherBank,
            bankId: seedIds.bankB,
            businessId: seedIds.businessOtherBank,
            businessName: "Synthetic Birch Services",
            productId: seedIds.productB,
            requestedAmount: normalizeMoney("10000"),
            purpose: "Synthetic isolated bank request",
            source: "seed",
            synthetic: true,
          },
          {
            id: seedIds.applicationSetupDraft,
            bankId: seedIds.bankA,
            businessId: seedIds.businessA,
            businessName: "Synthetic Cedar Workshop",
            contactId: seedIds.contactA,
            productId: seedIds.productA,
            source: "seed",
            synthetic: true,
          },
          {
            id: seedIds.applicationClosedDraft,
            bankId: seedIds.bankA,
            businessId: seedIds.businessA,
            businessName: "Synthetic Cedar Workshop",
            contactId: seedIds.contactA,
            productId: seedIds.productA,
            requestedAmount: normalizeMoney("25000"),
            status: "withdrawn",
            source: "seed",
            synthetic: true,
          },
          {
            id: seedIds.applicationEmpty,
            bankId: seedIds.bankA,
            productId: seedIds.productA,
            contactId: seedIds.contactA,
            source: "seed",
            synthetic: true,
          },
        ])
        .onConflictDoNothing();
      await tx
        .insert(applicationParticipants)
        .values([
          {
            bankId: seedIds.bankA,
            applicationId: seedIds.applicationSmall,
            userId: seedIds.borrower,
            role: "applicant_admin",
            scope: "full",
            synthetic: true,
          },
          {
            bankId: seedIds.bankA,
            applicationId: seedIds.applicationLarge,
            userId: seedIds.borrower,
            role: "applicant_admin",
            scope: "full",
            synthetic: true,
          },
          {
            bankId: seedIds.bankA,
            applicationId: seedIds.applicationSetupDraft,
            userId: seedIds.borrower,
            role: "applicant_admin",
            scope: "full",
            synthetic: true,
          },
          {
            bankId: seedIds.bankA,
            applicationId: seedIds.applicationClosedDraft,
            userId: seedIds.borrower,
            role: "applicant_admin",
            scope: "full",
            synthetic: true,
          },
          {
            bankId: seedIds.bankA,
            applicationId: seedIds.applicationSmall,
            userId: seedIds.adviser,
            role: "adviser",
            scope: "assigned",
            synthetic: true,
          },
          {
            bankId: seedIds.bankA,
            applicationId: seedIds.applicationLarge,
            userId: seedIds.revokedOwner,
            role: "owner",
            scope: "assigned",
            revokedAt: verifiedAt,
            synthetic: true,
          },
        ])
        .onConflictDoNothing();
      await tx
        .insert(businessRelationships)
        .values({
          id: seedIds.ownerRelationship,
          bankId: seedIds.bankA,
          applicationId: seedIds.applicationSmall,
          businessId: seedIds.businessA,
          displayName: "Synthetic Non-portal Owner",
          kind: "owner",
          ownershipPercent: "25.00",
          createdByUserId: seedIds.officerA,
          synthetic: true,
        })
        .onConflictDoNothing();
      const seededApplications = await tx
        .select()
        .from(applications)
        .where(
          inArray(applications.id, [
            seedIds.applicationSmall,
            seedIds.applicationLarge,
            seedIds.applicationUnshared,
            seedIds.applicationOtherBank,
            seedIds.applicationEmpty,
            seedIds.applicationSetupDraft,
            seedIds.applicationClosedDraft,
          ]),
        );
      await tx
        .insert(applicationSetups)
        .values(
          seededApplications.map((application) => {
            const completed =
              application.id !== seedIds.applicationClosedDraft && application.status !== "draft";
            const namedDraft = application.id === seedIds.applicationSetupDraft;
            return {
              applicationId: application.id,
              bankId: application.bankId,
              revision: application.revision,
              currentStep: completed ? "review" : namedDraft ? "amount" : "business_name",
              completedSteps: completed
                ? ["business_name", "product", "amount", "purpose"]
                : namedDraft
                  ? ["business_name"]
                  : [],
              skippedSteps: completed ? ["industry"] : [],
              completedAt: completed ? application.updatedAt : null,
              completedByUserId: completed ? seedIds.borrower : null,
            };
          }),
        )
        .onConflictDoNothing();
    });
  } finally {
    await pool.end();
  }
}
