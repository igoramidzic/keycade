import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as authSchema from "./auth-schema.js";
import * as documentSchema from "./document-schema.js";
import * as jobSchema from "./job-schema.js";
import * as coreSchema from "./schema.js";
import * as taskSchema from "./task-schema.js";

const schema = { ...coreSchema, ...jobSchema, ...authSchema, ...taskSchema, ...documentSchema };

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
export * from "./document-schema.js";
export * from "./job-schema.js";
export { normalizeMoney } from "./money.js";
export * from "./schema.js";

export * from "./task-schema.js";
