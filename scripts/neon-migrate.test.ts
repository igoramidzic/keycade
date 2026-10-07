import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  assertMigrationHistory,
  committedMigrationPlan,
  neonClientConfig,
  runNeonMigrations,
  safeMigrationError,
} from "./neon-migrate-lib";

const host = "ep-synthetic-example.us-east-2.aws.neon.tech";
const secret = "synthetic-private-password";
const validEnv = {
  NEON_DATABASE_URL: `postgresql://synthetic%40user:${secret}@${host}/neondb?sslmode=require&channel_binding=require`,
  NEON_DATABASE_HOST: host,
  NEON_DATABASE_NAME: "neondb",
};

describe("explicit guarded Neon connection settings", () => {
  test("uses direct credentials with certificate and hostname verification", () => {
    const config = neonClientConfig(validEnv);
    expect(config).toMatchObject({
      host,
      database: "neondb",
      user: "synthetic@user",
      password: secret,
      port: 5432,
      ssl: { rejectUnauthorized: true, servername: host },
      enableChannelBinding: true,
    });
    expect(config).not.toHaveProperty("connectionString");
    expect(
      neonClientConfig({
        ...validEnv,
        NEON_DATABASE_URL: validEnv.NEON_DATABASE_URL.replace(
          "sslmode=require",
          "sslmode=verify-full",
        ),
      }).ssl,
    ).toEqual(config.ssl);
  });

  test.each([
    ["missing URL", ""],
    ["wrong protocol", validEnv.NEON_DATABASE_URL.replace("postgresql:", "https:")],
    ["wrong host", validEnv.NEON_DATABASE_URL.replace(host, "ep-other.us-east-2.aws.neon.tech")],
    ["pooled endpoint", validEnv.NEON_DATABASE_URL.replace("example.", "example-pooler.")],
    ["wrong database", validEnv.NEON_DATABASE_URL.replace("/neondb?", "/otherdb?")],
    ["extra path", validEnv.NEON_DATABASE_URL.replace("/neondb?", "/neondb/other?")],
    ["wrong port", validEnv.NEON_DATABASE_URL.replace("/neondb?", ":5433/neondb?")],
    ["missing password", validEnv.NEON_DATABASE_URL.replace(secret, "")],
    ["missing user", validEnv.NEON_DATABASE_URL.replace("synthetic%40user", "")],
    ["fragment", `${validEnv.NEON_DATABASE_URL}#${secret}`],
    ["URL whitespace", ` ${validEnv.NEON_DATABASE_URL}`],
    ["disabled SSL", validEnv.NEON_DATABASE_URL.replace("sslmode=require", "sslmode=disable")],
    ["missing SSL", validEnv.NEON_DATABASE_URL.replace("sslmode=require&", "")],
    ["duplicate SSL", `${validEnv.NEON_DATABASE_URL}&sslmode=disable`],
    ["host override", `${validEnv.NEON_DATABASE_URL}&host=localhost`],
    ["options override", `${validEnv.NEON_DATABASE_URL}&options=-csearch_path=other`],
    ["certificate override", `${validEnv.NEON_DATABASE_URL}&sslrootcert=/private/file`],
    [
      "bad channel binding",
      validEnv.NEON_DATABASE_URL.replace("channel_binding=require", "channel_binding=disable"),
    ],
    ["malformed URL", `not-a-url-${secret}`],
    [
      "malformed credential escape",
      validEnv.NEON_DATABASE_URL.replace("synthetic%40user", "synthetic%ZZ"),
    ],
  ])("rejects %s without exposing the supplied secret", (_name, url) => {
    let failure: unknown;
    try {
      neonClientConfig({ ...validEnv, NEON_DATABASE_URL: url });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("Invalid Neon target");
    expect(String(failure)).not.toContain(secret);
    expect(String(failure)).not.toContain("synthetic@user");
    expect(String(failure)).not.toContain(host);
  });

  test.each([
    { NEON_DATABASE_HOST: undefined },
    { NEON_DATABASE_HOST: "localhost" },
    { NEON_DATABASE_HOST: `${host}.attacker.example` },
    { NEON_DATABASE_NAME: undefined },
    { NEON_DATABASE_NAME: "otherdb" },
  ])("requires independently matching nonsecret target settings: %j", (overrides) => {
    expect(() => neonClientConfig({ ...validEnv, ...overrides })).toThrow("Invalid Neon target");
  });

  test.each(["PGHOST", "PGOPTIONS", "PGSSLMODE", "PGPASSWORD", "PGREPLICATION"])(
    "rejects inherited %s overrides without logging them",
    (name) => {
      expect(() => neonClientConfig({ ...validEnv, [name]: secret })).toThrow(
        "reject PostgreSQL environment overrides",
      );
      try {
        neonClientConfig({ ...validEnv, [name]: secret });
      } catch (error) {
        expect(String(error)).not.toContain(secret);
      }
    },
  );

  test("refuses disabled TLS and execution outside GitHub before opening a connection", async () => {
    expect(() => neonClientConfig({ ...validEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" })).toThrow(
      "disabled TLS validation",
    );
    await expect(runNeonMigrations(validEnv)).rejects.toThrow("only in GitHub Actions");
    await expect(runNeonMigrations({ GITHUB_ACTIONS: "true" })).rejects.toThrow(
      "Invalid Neon target",
    );
  });

  test("redacts arbitrary driver errors and nested metadata", () => {
    const raw = Object.assign(new Error(`connection failed: ${validEnv.NEON_DATABASE_URL}`), {
      detail: secret,
      cause: new Error(secret),
    });
    const safe = safeMigrationError(raw);
    expect(safe.message).toContain("Database error details are withheld");
    expect(safe).not.toHaveProperty("cause");
    expect(safe).not.toHaveProperty("detail");
    expect(`${safe.stack}${JSON.stringify(safe)}`).not.toContain(secret);
  });
});

describe("committed migration consistency", () => {
  let folder: string;
  let journalPath: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "keycade-migration-plan-"));
    mkdirSync(join(folder, "meta"));
    journalPath = join(folder, "meta/_journal.json");
    writeFileSync(
      journalPath,
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          { idx: 0, version: "7", when: 100, tag: "0000_first", breakpoints: true },
          { idx: 1, version: "7", when: 200, tag: "0001_second", breakpoints: true },
        ],
      }),
    );
    writeFileSync(join(folder, "0000_first.sql"), "SELECT 1;");
    writeFileSync(join(folder, "0001_second.sql"), "SELECT 2;");
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  test("accepts the exact applied prefix and rejects changed, reordered, or future history", () => {
    const plan = committedMigrationPlan(folder);
    const history = plan.map((migration) => ({
      hash: migration.hash,
      created_at: String(migration.folderMillis),
    }));
    expect(() => assertMigrationHistory(plan, [])).not.toThrow();
    expect(() => assertMigrationHistory(plan, history.slice(0, 1))).not.toThrow();
    expect(() => assertMigrationHistory(plan, history)).not.toThrow();
    for (const invalid of [
      [{ ...history[0], hash: "changed" }],
      [{ ...history[0], created_at: "101" }],
      [history[1]],
      [...history, history[1]],
      [history[0], history[0]],
    ]) {
      expect(() => assertMigrationHistory(plan, invalid)).toThrow("history differs");
    }
  });

  test.each(["timestamp", "index", "tag", "duplicate", "version"])(
    "rejects a malformed %s journal before connecting",
    (field) => {
      const journal = JSON.parse(readFileSync(journalPath, "utf8"));
      if (field === "timestamp") journal.entries[1].when = 100;
      if (field === "index") journal.entries[1].idx = 2;
      if (field === "tag") journal.entries[1].tag = "../outside";
      if (field === "duplicate") journal.entries[1].tag = "0000_first";
      if (field === "version") journal.version = "invalid";
      writeFileSync(journalPath, JSON.stringify(journal));
      expect(() => committedMigrationPlan(folder)).toThrow("journal are inconsistent");
    },
  );

  test.each(["missing", "unlisted", "empty"])("rejects %s migration SQL", (condition) => {
    if (condition === "missing") rmSync(join(folder, "0001_second.sql"));
    if (condition === "unlisted") writeFileSync(join(folder, "0002_unlisted.sql"), "SELECT 3;");
    if (condition === "empty") writeFileSync(join(folder, "0001_second.sql"), "\n");
    expect(() => committedMigrationPlan(folder)).toThrow("journal are inconsistent");
  });
});
