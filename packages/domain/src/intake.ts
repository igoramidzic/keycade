import { publicIntakeParamsSchema, publicIntakeSchema } from "@keycade/contracts";
import { banks, type Database, loanProducts } from "@keycade/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { DomainError, deny } from "./errors.js";

/** Public product configuration only. A catalog read never creates a draft or grants access. */
export async function readPublicIntake(db: Database, input: unknown) {
  const parsed = publicIntakeParamsSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  const [bank] = await db
    .select({ id: banks.id, slug: banks.slug, name: banks.name, synthetic: banks.synthetic })
    .from(banks)
    .where(eq(banks.slug, parsed.data.bankSlug))
    .limit(1);
  if (!bank) return deny();
  // Match public-start's latest active version lookup; older in-flight applications keep their IDs.
  const products = await db
    .selectDistinctOn([loanProducts.slug], {
      id: loanProducts.id,
      slug: loanProducts.slug,
      name: loanProducts.name,
      version: loanProducts.version,
      minimumAmount: loanProducts.minimumAmount,
      maximumAmount: loanProducts.maximumAmount,
      currency: loanProducts.currency,
    })
    .from(loanProducts)
    .where(and(eq(loanProducts.bankId, bank.id), eq(loanProducts.active, true)))
    .orderBy(asc(loanProducts.slug), desc(loanProducts.version));
  return publicIntakeSchema.parse({ bank, products });
}
