import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as authSchema from "./auth-schema.js";
import * as checkSchema from "./check-schema.js";
import * as closingSchema from "./closing-schema.js";
import * as demoInboxSchema from "./demo-inbox-schema.js";
import * as documentMetadataSchema from "./document-metadata-schema.js";
import * as documentProcessingSchema from "./document-processing-schema.js";
import * as documentSchema from "./document-schema.js";
import * as enrichmentSchema from "./enrichment-schema.js";
import * as financialFactsSchema from "./financial-facts-schema.js";
import * as jobSchema from "./job-schema.js";
import * as reviewSchema from "./review-schema.js";
import * as coreSchema from "./schema.js";
import * as signatureSchema from "./signature-schema.js";
import * as taskSchema from "./task-schema.js";

const schema = {
  ...financialFactsSchema,
  ...closingSchema,
  ...demoInboxSchema,
  ...documentMetadataSchema,
  ...reviewSchema,
  ...signatureSchema,
  ...checkSchema,
  ...enrichmentSchema,
  ...coreSchema,
  ...jobSchema,
  ...authSchema,
  ...taskSchema,
  ...documentSchema,
  ...documentProcessingSchema,
};

/** Server-only connection; callers own pool.end() on shutdown. No connection is opened on import. */
export function createDatabase(connectionString: string, options: { max?: number } = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export * from "./auth-schema.js";
export * from "./check-schema.js";
export * from "./closing-schema.js";
export * from "./demo-inbox-schema.js";
export * from "./document-metadata-schema.js";
export * from "./document-processing-schema.js";
export * from "./document-schema.js";
export * from "./enrichment-schema.js";
export * from "./financial-facts-schema.js";
export * from "./job-schema.js";
export { normalizeMoney } from "./money.js";
export * from "./notification-schema.js";
export * from "./review-schema.js";
export * from "./schema.js";
export * from "./signature-schema.js";
export * from "./task-schema.js";
