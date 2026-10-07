import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { loadServerEnv, projectRoot } from "@keycade/config/server";
import { parse } from "dotenv";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  assertLocalTarget,
  assertPortFree,
  generateEnvironment,
  run,
  startServices,
} from "./local-lib";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

let directory: string;
let file: string;
let template: string;

beforeEach(() => {
  vi.mocked(spawnSync).mockReset();
  directory = mkdtempSync(path.join(os.tmpdir(), "keycade-local-config-"));
  file = path.join(directory, ".env");
  template = path.join(directory, ".env.example");
  copyFileSync(path.join(projectRoot, ".env.example"), template);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("repeatable local environment generation", () => {
  test("generates stable private credentials and an authenticated URL once", () => {
    generateEnvironment(file, template);
    const first = readFileSync(file, "utf8");
    const values = parse(first);
    expect(values.DB_PASSWORD).toMatch(/^[a-f0-9]{48}$/);
    expect(values.SESSION_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(values.ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/);
    expect(values.SESSION_SECRET).not.toBe(values.ENCRYPTION_KEY);
    const url = new URL(values.DATABASE_URL ?? "");
    expect(decodeURIComponent(url.password)).toBe(values.DB_PASSWORD);
    expect(url.hostname).toBe(values.DB_HOST);
    expect(url.port).toBe(values.DB_PORT);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    generateEnvironment(file, template);
    expect(readFileSync(file, "utf8")).toBe(first);
    expect(() => assertLocalTarget(loadServerEnv(values))).not.toThrow();
  });

  test("preserves comments, edited ports, quoted values, and unknown keys", () => {
    const existing = [
      "# Local customization must survive initialization",
      "BANK_SITE_PORT=3300",
      'DB_PASSWORD="synthetic password :#?%12345"',
      'CUSTOM_NOTE="leave this value alone"',
      `SESSION_SECRET=${"s".repeat(32)}`,
      `ENCRYPTION_KEY=${"a".repeat(64)}`,
      "",
    ].join("\n");
    writeFileSync(file, existing, { mode: 0o644 });
    generateEnvironment(file, template);
    const contents = readFileSync(file, "utf8");
    const values = parse(contents);
    expect(contents.startsWith(existing)).toBe(true);
    expect(values.BANK_SITE_PORT).toBe("3300");
    expect(values.CUSTOM_NOTE).toBe("leave this value alone");
    expect(values.SESSION_SECRET).toBe("s".repeat(32));
    expect(values.ENCRYPTION_KEY).toBe("a".repeat(64));
    expect(decodeURIComponent(new URL(values.DATABASE_URL ?? "").password)).toBe(
      "synthetic password :#?%12345",
    );
    expect(statSync(file).mode & 0o777).toBe(0o600);
    generateEnvironment(file, template);
    expect(readFileSync(file, "utf8")).toBe(contents);
  });

  test("fills blank template credentials without erasing existing data", () => {
    copyFileSync(template, file);
    generateEnvironment(file, template);
    const values = parse(readFileSync(file));
    expect(values.DB_PASSWORD).not.toBe("");
    expect(values.DATABASE_URL).not.toBe("");
    expect(values.SESSION_SECRET).not.toBe("");
    expect(values.ENCRYPTION_KEY).not.toBe("");
    expect(() => loadServerEnv(values)).not.toThrow();
  });

  test("initializes an existing empty env file and preserves the generated values on rerun", () => {
    writeFileSync(file, "", { mode: 0o644 });
    generateEnvironment(file, template);
    const first = readFileSync(file, "utf8");
    const values = parse(first);
    expect(() => loadServerEnv(values)).not.toThrow();
    expect(values.SESSION_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    generateEnvironment(file, template);
    expect(readFileSync(file, "utf8")).toBe(first);
  });

  test.each(['SESSION_SECRET = ""', 'export SESSION_SECRET = ""'])(
    "fills the valid dotenv blank assignment %s without disturbing other edits",
    (assignment) => {
      writeFileSync(file, `# Keep this comment\n${assignment}\nCUSTOM_NOTE=keep-me\n`);
      generateEnvironment(file, template);
      const first = readFileSync(file, "utf8");
      const values = parse(first);
      expect(values.SESSION_SECRET).toMatch(/^[a-f0-9]{64}$/);
      expect(values.CUSTOM_NOTE).toBe("keep-me");
      expect(first).toContain("# Keep this comment\n");
      expect(() => loadServerEnv(values)).not.toThrow();
      generateEnvironment(file, template);
      expect(readFileSync(file, "utf8")).toBe(first);
    },
  );
});

describe("safe infrastructure preflight", () => {
  test.each(["CONTAINER_HOST", "CONTAINER_CONNECTION"])(
    "refuses %s overrides before spawning Podman and omits their values",
    (key) => {
      vi.stubEnv("CONTAINER_HOST", undefined);
      vi.stubEnv("CONTAINER_CONNECTION", undefined);
      const sensitiveValue = "ssh://synthetic-private-user:synthetic-secret@remote.example.invalid";
      vi.stubEnv(key, sensitiveValue);
      vi.mocked(spawnSync).mockImplementation(() => {
        throw new Error("Podman must not be invoked with remote overrides.");
      });
      let failure: unknown;
      try {
        run("podman", ["info"]);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toContain("Unset CONTAINER_HOST and CONTAINER_CONNECTION");
      expect(String(failure)).toContain("remote Podman overrides are not allowed");
      expect(String(failure)).not.toContain(sensitiveValue);
      expect(String(failure)).not.toContain("synthetic-secret");
      expect(spawnSync).not.toHaveBeenCalled();
    },
  );

  test.each([
    [
      "remote hostname",
      (url: URL) => {
        url.hostname = "database.example.invalid";
      },
    ],
    [
      "different port",
      (url: URL) => {
        url.port = "54330";
      },
    ],
    [
      "different database",
      (url: URL) => {
        url.pathname = "/keycade_other";
      },
    ],
    [
      "different credentials",
      (url: URL) => {
        url.password = "synthetic-other-password";
      },
    ],
    [
      "URL options",
      (url: URL) => {
        url.search = "?host=database.example.invalid";
      },
    ],
  ])("rejects %s before invoking Podman or changing files", async (_label, edit) => {
    generateEnvironment(file, template);
    const before = readFileSync(file, "utf8");
    const env = loadServerEnv(parse(before));
    const url = new URL(env.DATABASE_URL);
    edit(url);
    vi.mocked(spawnSync).mockImplementation(() => {
      throw new Error("Infrastructure execution must not be reached.");
    });
    await expect(startServices({ ...env, DATABASE_URL: url.toString() })).rejects.toThrow(
      "Refusing an unfamiliar database target",
    );
    expect(spawnSync).not.toHaveBeenCalled();
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("reports a port collision while leaving the existing server running", async () => {
    const occupant = net.createServer((socket) => socket.end("owned by another process"));
    await new Promise<void>((resolve, reject) => {
      occupant.once("error", reject);
      occupant.listen(0, "127.0.0.1", resolve);
    });
    const address = occupant.address();
    if (!address || typeof address === "string") throw new Error("No TCP port assigned.");
    try {
      await expect(assertPortFree(address.port)).rejects.toThrow("Keycade did not stop it");
      expect(occupant.listening).toBe(true);
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(address.port, "127.0.0.1");
        socket.once("error", reject);
        socket.once("data", (data) => {
          socket.end();
          resolve(data.toString());
        });
      });
      expect(response).toBe("owned by another process");
    } finally {
      await new Promise<void>((resolve, reject) =>
        occupant.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await expect(assertPortFree(address.port)).resolves.toBeUndefined();
  });

  test("a missing executable yields a bounded, actionable error without printing arguments", () => {
    const missing = path.join(directory, "missing-keycade-tool");
    const started = Date.now();
    expect(() =>
      run(missing, ["synthetic-secret-that-must-not-be-logged"], { timeout: 100 }),
    ).toThrow(`Missing prerequisite: ${missing}. Install it, then rerun pnpm initialize`);
    expect(Date.now() - started).toBeLessThan(2_000);
    try {
      run(missing, ["synthetic-secret-that-must-not-be-logged"], { timeout: 100 });
    } catch (error) {
      expect(String(error)).not.toContain("synthetic-secret-that-must-not-be-logged");
    }
  });

  test("a hung prerequisite is terminated within its configured bound", () => {
    const started = Date.now();
    expect(() =>
      run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeout: 100 }),
    ).toThrow("failed or timed out");
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
