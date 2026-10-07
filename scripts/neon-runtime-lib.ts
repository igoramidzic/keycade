import type { Client } from "pg";

export const runtimeRole = "keycade_runtime";

/** Run only with the migration connection; the application role cannot administer schema or roles. */
export async function configureRuntimeRole(client: Client, password: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(password)) throw new Error("Invalid runtime credential.");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(1801812323, 1919247461)");
    const existing = await client.query<{ privileged: boolean }>(
      `SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
        OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = pg_roles.oid) AS privileged
       FROM pg_roles WHERE rolname = $1`,
      [runtimeRole],
    );
    if (existing.rows[0]?.privileged) throw new Error("Runtime role has unexpected privileges.");
    const statement = await client.query<{ statement: string }>(
      existing.rowCount
        ? "SELECT format('ALTER ROLE keycade_runtime LOGIN NOINHERIT PASSWORD %L', $1::text) AS statement"
        : "SELECT format('CREATE ROLE keycade_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text) AS statement",
      [password],
    );
    await client.query(statement.rows[0].statement);
    await client.query("GRANT USAGE ON SCHEMA public, drizzle TO keycade_runtime");
    await client.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO keycade_runtime",
    );
    await client.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO keycade_runtime");
    await client.query("GRANT SELECT ON drizzle.__drizzle_migrations TO keycade_runtime");
    await client.query("REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM keycade_runtime");
    await client.query(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO keycade_runtime",
    );
    await client.query(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO keycade_runtime",
    );
    const check = await client.query<{ safe: boolean }>(
      `SELECT NOT has_schema_privilege('keycade_runtime', 'public', 'CREATE')
        AND NOT has_table_privilege('keycade_runtime', 'audit_events', 'UPDATE')
        AND NOT has_table_privilege('keycade_runtime', 'audit_events', 'DELETE')
        AND has_table_privilege('keycade_runtime', 'integration_runs', 'UPDATE')
        AND has_table_privilege('keycade_runtime', 'drizzle.__drizzle_migrations', 'SELECT') AS safe`,
    );
    if (!check.rows[0]?.safe) throw new Error("Runtime permissions did not verify.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
