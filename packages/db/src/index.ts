import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as jobSchema from "./job-schema.js";
import * as coreSchema from "./schema.js";

const schema = { ...coreSchema, ...jobSchema };

/** Server-only connection; callers own pool.end() on shutdown. No connection is opened on import. */
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export * from "./job-schema.js";
export { normalizeMoney } from "./money.js";
export * from "./schema.js";
