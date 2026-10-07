import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { envFile, loadServerEnv, projectRoot, type ServerEnv } from "@keycade/config/server";
import { parse } from "dotenv";
import pg from "pg";

const ownerLabel = "io.keycade.workspace";
export function generateEnvironment(
  file = envFile,
  template = path.join(projectRoot, ".env.example"),
) {
  const defaults = parse(readFileSync(template));
  const previous = existsSync(file) ? readFileSync(file, "utf8") : "";
  const current = parse(previous);
  const next = { ...defaults, ...current };
  // Missing values are generated only once. Existing nonempty values always win.
  next.DB_PASSWORD ||= randomBytes(24).toString("hex");
  next.SESSION_SECRET ||= randomBytes(32).toString("hex");
  next.ENCRYPTION_KEY ||= randomBytes(32).toString("hex");
  next.DATABASE_URL ||= `postgresql://${encodeURIComponent(next.DB_USER ?? "keycade")}:${encodeURIComponent(next.DB_PASSWORD)}@${next.DB_HOST}:${next.DB_PORT}/${next.DB_NAME}`;
  if (!existsSync(file))
    writeFileSync(
      file,
      Object.entries(next)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
      { mode: 0o600, flag: "wx" },
    );
  else {
    let updated = previous;
    for (const [key, value] of Object.entries(next)) {
      if (!(key in current)) updated += `${updated.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
      else if (!current[key] && value)
        updated = updated.replace(
          new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "m"),
          `${key}=${value}`,
        );
    }
    if (updated !== previous) writeFileSync(file, updated, { mode: 0o600 });
  }
  chmodSync(file, 0o600);
}
export function assertLocalTarget(env: ServerEnv) {
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("Invalid DATABASE_URL. Value omitted.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.hostname !== env.DB_HOST ||
    url.port !== String(env.DB_PORT) ||
    decodeURIComponent(url.pathname.slice(1)) !== env.DB_NAME ||
    decodeURIComponent(url.username) !== env.DB_USER ||
    decodeURIComponent(url.password) !== env.DB_PASSWORD ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Refusing an unfamiliar database target. DATABASE_URL must match the project-owned local DB_HOST/PORT/NAME/USER/PASSWORD without URL parameters. No resources were changed.",
    );
  }
}
export function run(
  binary: string,
  args: string[],
  options: { input?: string; inherit?: boolean; timeout?: number } = {},
) {
  if (binary === "podman" && (process.env.CONTAINER_HOST || process.env.CONTAINER_CONNECTION)) {
    throw new Error(
      "Unset CONTAINER_HOST and CONTAINER_CONNECTION before using Keycade local infrastructure; remote Podman overrides are not allowed.",
    );
  }
  const result = spawnSync(binary, args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
    input: options.input,
    stdio: options.inherit ? "inherit" : "pipe",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT")
      throw new Error(
        `Missing prerequisite: ${binary}. Install it, then rerun pnpm initialize. Podman: https://podman.io/docs/installation`,
      );
    // Never echo command arguments, environment, stdin, or raw container/database errors.
    throw new Error(
      `${binary} ${args[0] ?? "command"} failed or timed out. Check service status and available resources; no automatic reset was attempted.`,
    );
  }
  return result.stdout?.trim() ?? "";
}
export function checkRuntime() {
  if (process.versions.node.split(".")[0] !== "24")
    throw new Error(
      "Node 24 LTS is required. Run pnpm install (provides project-local Node), or nvm install && nvm use.",
    );
}
export function ensureEngine(env: ServerEnv) {
  run("podman", ["--version"]);
  if (process.platform === "darwin") {
    const connections = JSON.parse(
      run("podman", ["system", "connection", "list", "--format", "json"]),
    ) as { Default: boolean; URI: string }[];
    const active = connections.find((c) => c.Default);
    if (!active || !/^ssh:\/\/[^@]+@127\.0\.0\.1:/.test(active.URI))
      throw new Error(
        "Select a local Podman machine connection before initialization. Remote engines are not supported.",
      );
    const machines = JSON.parse(run("podman", ["machine", "list", "--format", "json"])) as {
      Name: string;
      Running: boolean;
    }[];
    const machine = machines.find((m) => m.Name === env.PODMAN_MACHINE);
    if (!machine)
      throw new Error(
        "Configured Podman machine is missing. Run podman machine init, set PODMAN_MACHINE in .env, then retry.",
      );
    if (!machine.Running) {
      console.log("Starting the configured local Podman machine…");
      run("podman", ["machine", "start", env.PODMAN_MACHINE], { timeout: 120_000 });
    }
  }
  run("podman", ["info", "--format", "json"]);
}
interface ContainerInfo {
  Id: string;
  State: { Running: boolean };
  Config: { Labels: Record<string, string>; Env: string[]; Image: string };
  HostConfig: { PortBindings: Record<string, { HostIp: string; HostPort: string }[]> };
  Mounts: { Name?: string; Destination: string }[];
}
function inspectContainer(name: string): ContainerInfo | undefined {
  const names = JSON.parse(run("podman", ["ps", "-a", "--format", "json"])) as {
    Names: string[];
  }[];
  if (!names.some((c) => c.Names.includes(name))) return undefined;
  return JSON.parse(run("podman", ["container", "inspect", name]))[0] as ContainerInfo;
}
export async function assertPortFree(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Local port ${port} is already in use. Change the matching port in .env or stop its owner yourself. Keycade did not stop it.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });
}
function verifyContainer(env: ServerEnv, info: ContainerInfo, kind: "db" | "mail") {
  if (
    info.Config.Labels?.[ownerLabel] !== projectRoot ||
    info.Config.Labels?.["io.keycade.project"] !== env.PROJECT_NAME
  )
    throw new Error(
      "Container name is owned by another project. Choose another PROJECT_NAME; no resources were changed.",
    );
  const ports =
    kind === "db"
      ? [[5432, env.DB_PORT]]
      : [
          [1025, env.MAILPIT_SMTP_PORT],
          [8025, env.MAILPIT_UI_PORT],
        ];
  for (const [inner, outer] of ports) {
    const bindings = info.HostConfig.PortBindings[`${inner}/tcp`];
    if (
      bindings?.length !== 1 ||
      bindings[0]?.HostIp !== "127.0.0.1" ||
      bindings[0]?.HostPort !== String(outer)
    )
      throw new Error(
        "Existing container ports do not match .env loopback bindings. Restore .env or use a new project name/ports; existing data was preserved.",
      );
  }
  if (kind === "db") {
    const settings = Object.fromEntries(
      info.Config.Env.map((entry) => {
        const at = entry.indexOf("=");
        return [entry.slice(0, at), entry.slice(at + 1)];
      }),
    );
    if (
      settings.POSTGRES_USER !== env.DB_USER ||
      settings.POSTGRES_DB !== env.DB_NAME ||
      !info.Mounts.some(
        (m) =>
          m.Name === `${env.PROJECT_NAME}-postgres-data` &&
          m.Destination === "/var/lib/postgresql/data",
      )
    )
      throw new Error(
        "Existing database identity/storage does not match project configuration. No changes were made.",
      );
  }
}
export function assertOwnedDatabase(env: ServerEnv) {
  assertLocalTarget(env);
  const container = inspectContainer(`${env.PROJECT_NAME}-postgres`);
  if (!container) throw new Error("Project database container is missing. Run pnpm initialize.");
  verifyContainer(env, container, "db");
  if (!container.State.Running) throw new Error("Project database is stopped. Run pnpm db:start.");
}
export async function startServices(env: ServerEnv, mail = true) {
  assertLocalTarget(env);
  ensureEngine(env);
  const kinds = mail ? (["db", "mail"] as const) : (["db"] as const);
  // Inspect all resources and ports before creating anything.
  for (const kind of kinds) {
    const name = `${env.PROJECT_NAME}-${kind === "db" ? "postgres" : "mailpit"}`;
    const info = inspectContainer(name);
    if (info) verifyContainer(env, info, kind);
    if (!info?.State.Running)
      for (const p of kind === "db" ? [env.DB_PORT] : [env.MAILPIT_SMTP_PORT, env.MAILPIT_UI_PORT])
        await assertPortFree(p);
  }
  for (const kind of kinds) {
    const name = `${env.PROJECT_NAME}-${kind === "db" ? "postgres" : "mailpit"}`;
    const info = inspectContainer(name);
    if (info) {
      if (!info.State.Running) run("podman", ["start", name]);
      continue;
    }
    const labels = [
      "--label",
      `${ownerLabel}=${projectRoot}`,
      "--label",
      `io.keycade.project=${env.PROJECT_NAME}`,
    ];
    const args = ["run", "--detach", "--name", name, ...labels];
    if (kind === "db") {
      const volume = `${env.PROJECT_NAME}-postgres-data`;
      const volumes = JSON.parse(run("podman", ["volume", "ls", "--format", "json"])) as {
        Name: string;
        Labels?: Record<string, string>;
      }[];
      const existing = volumes.find((v) => v.Name === volume);
      if (
        existing &&
        (existing.Labels?.[ownerLabel] !== projectRoot ||
          existing.Labels?.["io.keycade.project"] !== env.PROJECT_NAME)
      )
        throw new Error(
          "Existing volume belongs to another project. Choose another PROJECT_NAME. Nothing was deleted.",
        );
      if (!existing) run("podman", ["volume", "create", ...labels, volume]);
      args.push(
        "--publish",
        `127.0.0.1:${env.DB_PORT}:5432`,
        "--volume",
        `${volume}:/var/lib/postgresql/data`,
        "--env-file",
        "/dev/stdin",
        env.POSTGRES_IMAGE,
      );
      run("podman", args, {
        input: `POSTGRES_USER=${env.DB_USER}\nPOSTGRES_PASSWORD=${env.DB_PASSWORD}\nPOSTGRES_DB=${env.DB_NAME}\n`,
        timeout: 180_000,
      });
    } else {
      args.push(
        "--publish",
        `127.0.0.1:${env.MAILPIT_SMTP_PORT}:1025`,
        "--publish",
        `127.0.0.1:${env.MAILPIT_UI_PORT}:8025`,
        env.MAILPIT_IMAGE,
      );
      run("podman", args, { timeout: 180_000 });
    }
  }
}
export function stopServices(env: ServerEnv, mail = true) {
  assertLocalTarget(env);
  for (const kind of mail ? (["db", "mail"] as const) : (["db"] as const)) {
    const name = `${env.PROJECT_NAME}-${kind === "db" ? "postgres" : "mailpit"}`;
    const info = inspectContainer(name);
    if (info) {
      verifyContainer(env, info, kind);
      if (info.State.Running) run("podman", ["stop", "--time", "10", name]);
    }
  }
  console.log("Project containers stopped. Database volume and private files are preserved.");
}
export async function waitForDatabase(env: Pick<ServerEnv, "DATABASE_URL">, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const client = new pg.Client({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 1000,
      query_timeout: 1000,
    });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return;
    } catch {
      if (attempt === attempts - 1)
        throw new Error(
          "Database readiness failed: authenticated SELECT 1 could not complete. Check .env credentials and pnpm db:status; run pnpm initialize if services are missing. Connection values omitted.",
        );
    } finally {
      await client.end().catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
export function preparePrivateStorage(env: ServerEnv) {
  if (!env.PRIVATE_STORAGE_PATH.startsWith(path.join(projectRoot, ".local") + path.sep))
    throw new Error(
      "PRIVATE_STORAGE_PATH must be inside this checkout's ignored .local directory.",
    );
  mkdirSync(env.PRIVATE_STORAGE_PATH, { recursive: true, mode: 0o700 });
}
export function localEnv() {
  checkRuntime();
  return loadServerEnv();
}
