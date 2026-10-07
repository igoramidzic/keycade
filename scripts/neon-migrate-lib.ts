import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationsFolder } from "@keycade/db/migrate";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, type ClientConfig } from "pg";

const failures = {
  ci: "Hosted migrations run only in GitHub Actions. Use the Neon migration workflow.",
  target:
    "Invalid Neon target. Set NEON_DATABASE_URL, NEON_DATABASE_HOST, and NEON_DATABASE_NAME to the same direct Neon database, with sslmode=require or verify-full and no connection overrides.",
  overrides:
    "Hosted migrations reject PostgreSQL environment overrides or disabled TLS validation.",
  plan: "Committed migration files and journal are inconsistent. Review the migration changes.",
  history:
    "Database migration history differs from this checkout. Do not edit applied migrations or deploy an older checkout.",
  database: "The connected database differs from NEON_DATABASE_NAME. No migration was applied.",
  connection:
    "Hosted migration failed. Check database credentials, connectivity, permissions, and reviewed SQL. Database error details are withheld to protect credentials and data.",
} as const;

export class HostedMigrationError extends Error {}

export function safeMigrationError(error: unknown): HostedMigrationError {
  return error instanceof HostedMigrationError
    ? error
    : new HostedMigrationError(failures.connection);
}

/** Parse explicitly supplied CI settings only; never read local .env or Neon CLI files. */
export function neonClientConfig(env: NodeJS.ProcessEnv): ClientConfig {
  if (
    env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    Object.entries(env).some(([name, value]) => /^PG[A-Z_]+$/.test(name) && Boolean(value))
  ) {
    throw new HostedMigrationError(failures.overrides);
  }
  try {
    const raw = env.NEON_DATABASE_URL;
    const host = env.NEON_DATABASE_HOST;
    const database = env.NEON_DATABASE_NAME;
    if (!raw || !host || !database || raw !== raw.trim()) throw new Error();
    const url = new URL(raw);
    const sslmode = url.searchParams.get("sslmode");
    const channelBinding = url.searchParams.get("channel_binding");
    const options = [...url.searchParams.keys()];
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(host) ||
      host.split(".")[0].endsWith("-pooler") ||
      url.hostname !== host ||
      (url.port !== "" && url.port !== "5432") ||
      !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(database) ||
      decodeURIComponent(url.pathname) !== `/${database}` ||
      !url.username ||
      !url.password ||
      url.hash !== "" ||
      !["require", "verify-full"].includes(sslmode ?? "") ||
      (channelBinding !== null && channelBinding !== "require") ||
      options.some((key) => key !== "sslmode" && key !== "channel_binding") ||
      new Set(options).size !== options.length
    ) {
      throw new Error();
    }
    // Do not pass connectionString: pg URL parameters can override an explicit SSL object.
    return {
      host,
      port: 5432,
      database,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl: { rejectUnauthorized: true, servername: host },
      enableChannelBinding: true,
      application_name: "keycade-github-migrations",
      connectionTimeoutMillis: 15_000,
      statement_timeout: 120_000,
      lock_timeout: 60_000,
      idle_in_transaction_session_timeout: 120_000,
    };
  } catch {
    throw new HostedMigrationError(failures.target);
  }
}

/** Validate the journal before Drizzle's timestamp-based migrator can skip a file. */
export function committedMigrationPlan(folder = migrationsFolder): MigrationMeta[] {
  try {
    const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8"));
    if (
      journal.version !== "7" ||
      journal.dialect !== "postgresql" ||
      !Array.isArray(journal.entries) ||
      journal.entries.length === 0
    ) {
      throw new Error();
    }
    let previousTimestamp = -1;
    const filenames = new Set<string>();
    for (const [index, entry] of journal.entries.entries()) {
      if (
        entry.idx !== index ||
        entry.version !== "7" ||
        !Number.isSafeInteger(entry.when) ||
        entry.when <= previousTimestamp ||
        typeof entry.tag !== "string" ||
        !/^\d{4,}_[a-zA-Z0-9_-]+$/.test(entry.tag) ||
        typeof entry.breakpoints !== "boolean" ||
        filenames.has(`${entry.tag}.sql`)
      ) {
        throw new Error();
      }
      previousTimestamp = entry.when;
      filenames.add(`${entry.tag}.sql`);
    }
    const sqlFiles = readdirSync(folder).filter((name) => name.endsWith(".sql"));
    if (sqlFiles.length !== filenames.size || sqlFiles.some((name) => !filenames.has(name))) {
      throw new Error();
    }
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    if (
      migrations.length !== filenames.size ||
      migrations.some((migration) => migration.sql.every((statement) => !statement.trim()))
    ) {
      throw new Error();
    }
    return migrations;
  } catch {
    throw new HostedMigrationError(failures.plan);
  }
}

type MigrationHistory = { hash: string; created_at: string | number | null }[];

export function assertMigrationHistory(plan: MigrationMeta[], history: MigrationHistory): void {
  if (
    history.length > plan.length ||
    history.some(
      (applied, index) =>
        applied.hash !== plan[index].hash ||
        String(applied.created_at) !== String(plan[index].folderMillis),
    )
  ) {
    throw new HostedMigrationError(failures.history);
  }
}

async function migrationHistory(client: Client): Promise<MigrationHistory> {
  const exists = await client.query<{ migration_table: string | null }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') AS migration_table",
  );
  if (!exists.rows[0].migration_table) return [];
  const result = await client.query<MigrationHistory[number]>(
    "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id",
  );
  return result.rows;
}

// A stable two-int key shared by every Keycade deployment, scoped by PostgreSQL database.
export const migrationLock = [1801812323, 1835624306] as const;

/** The caller owns this dedicated connection; tests supply only a disposable local database. */
export async function applyCommittedMigrations(
  client: Client,
  expectedDatabase: string,
  folder = migrationsFolder,
): Promise<{ applied: number; total: number }> {
  let locked = false;
  try {
    const plan = committedMigrationPlan(folder);
    const current = await client.query<{ database: string }>(
      "SELECT current_database() AS database",
    );
    if (current.rows[0].database !== expectedDatabase) {
      throw new HostedMigrationError(failures.database);
    }
    await client.query("SELECT pg_advisory_lock($1, $2)", [...migrationLock]);
    locked = true;
    const before = await migrationHistory(client);
    assertMigrationHistory(plan, before);
    // Native Drizzle migrator: one transaction for all pending SQL and its history rows.
    // Binding it to this Client keeps it inside the same session's advisory lock.
    if (before.length < plan.length) {
      await migrate(drizzle(client), { migrationsFolder: folder });
    }
    const after = await migrationHistory(client);
    assertMigrationHistory(plan, after);
    if (after.length !== plan.length) throw new HostedMigrationError(failures.history);
    return { applied: after.length - before.length, total: after.length };
  } catch (error) {
    throw safeMigrationError(error);
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [...migrationLock]);
      } catch {
        throw new HostedMigrationError(failures.connection);
      }
    }
  }
}

export async function runNeonMigrations(env: NodeJS.ProcessEnv = process.env) {
  if (env.GITHUB_ACTIONS !== "true") throw new HostedMigrationError(failures.ci);
  const config = neonClientConfig(env);
  // Reject malformed migration plans before opening any remote connection.
  committedMigrationPlan();
  const client = new Client(config);
  // Connection-loss events must never print raw driver metadata as unhandled events.
  client.on("error", () => {});
  try {
    await client.connect();
    return await applyCommittedMigrations(client, config.database as string);
  } catch (error) {
    throw safeMigrationError(error);
  } finally {
    await client.end().catch(() => {});
  }
}
