import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { projectRoot } from "@keycade/config/server";
import { seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { initializeQueue } from "@keycade/integrations";
import { assertLocalTarget, assertOwnedDatabase, localEnv, waitForDatabase } from "./local-lib";

type Process = { child: ChildProcess; done: Promise<number>; closed: boolean };
type Report = {
  suites?: { specs?: { tests: unknown[] }[]; suites?: Report["suites"] }[];
  stats: { expected: number; unexpected: number; skipped: number; flaky: number };
};
class RunnerError extends Error {}
const processes = new Set<Process>();
const abort = new AbortController();

function signal(owned: Process, value: NodeJS.Signals) {
  if (!owned.child.pid || owned.closed) return;
  try {
    if (process.platform === "win32") owned.child.kill(value);
    else process.kill(-owned.child.pid, value);
  } catch {
    // This runner only signals process groups it created; a finished child needs no cleanup.
  }
}
for (const name of ["SIGINT", "SIGTERM"] as const)
  process.once(name, () => {
    process.exitCode = name === "SIGINT" ? 130 : 143;
    abort.abort();
    for (const child of processes) signal(child, "SIGTERM");
  });

function launch(
  args: string[],
  env: NodeJS.ProcessEnv,
  log: string,
  options: { cwd?: string } = {},
): Process {
  abort.signal.throwIfAborted();
  const fd = openSync(log, "a", 0o600);
  const child = spawn(process.execPath, args, {
    cwd: options.cwd ?? projectRoot,
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  const owned: Process = { child, closed: false, done: Promise.resolve(1) };
  owned.done = new Promise<number>((resolve) => {
    child.once("error", () => resolve(1));
    child.once("close", (code) => {
      owned.closed = true;
      processes.delete(owned);
      resolve(code ?? 1);
    });
  });
  processes.add(owned);
  return owned;
}
async function stop(child: Process) {
  signal(child, "SIGTERM");
  const timeout = setTimeout(() => signal(child, "SIGKILL"), 5_000);
  try {
    await child.done;
  } finally {
    clearTimeout(timeout);
  }
}
async function freePorts(count: number) {
  const reservations: net.Server[] = [];
  try {
    const ports: number[] = [];
    for (let i = 0; i < count; i++) {
      const server = net.createServer();
      reservations.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new RunnerError("No free local port.");
      ports.push(address.port);
    }
    return ports;
  } finally {
    await Promise.all(
      reservations.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  }
}
async function ready(url: string, children: Process[]) {
  for (let attempt = 0; attempt < 120; attempt++) {
    abort.signal.throwIfAborted();
    if (children.some((child) => child.closed))
      throw new RunnerError("An isolated browser-test service stopped. Check its private log.");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // Startup may take a few moments. Never print raw network/database errors.
    }
    await delay(250, undefined, { signal: abort.signal });
  }
  throw new RunnerError("Isolated browser-test readiness timed out. Check the private logs.");
}
function countTests(suites: Report["suites"]): number {
  return (suites ?? []).reduce(
    (total, suite) =>
      total +
      (suite.specs ?? []).reduce((count, spec) => count + spec.tests.length, 0) +
      countTests(suite.suites),
    0,
  );
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  // Filtering, project selection and headed runs are forwarded. Isolation owns these options.
  if (
    args.some((arg) =>
      /^(?:-c|-j|--(?:config|shard|workers|retries|repeat-each|reporter|add-reporter|output|list|ui(?:-host|-port)?|debug|last-failed(?:-file)?))(?:=|$)/.test(
        arg,
      ),
    )
  )
    throw new RunnerError(
      "The isolated runner owns configuration, sharding, reports and concurrency. Use pnpm exec playwright test for advanced interactive options.",
    );
  const local = localEnv();
  assertLocalTarget(local);
  assertOwnedDatabase(local);
  await waitForDatabase(local, 1);
  const mail = await fetch(`http://127.0.0.1:${local.MAILPIT_UI_PORT}/api/v1/messages?limit=1`, {
    signal: AbortSignal.timeout(3_000),
  }).catch(() => null);
  if (!mail?.ok) throw new RunnerError("Local Mailpit is unavailable. Run pnpm infra:start.");
  await mail.body?.cancel();
  const directory = path.join(projectRoot, ".local");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const runDirectory = mkdtempSync(path.join(directory, "e2e-"));
  console.log(`Browser-test logs and results: ${path.relative(projectRoot, runDirectory)}`);
  let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
  try {
    database = await createTestDatabase(local.DATABASE_URL);
    await seedDatabase(database.connectionString);
    await initializeQueue(database.connectionString);
    const [apiPort, bankPort, borrowerPort, staffPort] = await freePorts(4);
    const env = {
      ...process.env,
      DATABASE_URL: database.connectionString,
      NODE_ENV: "development",
      API_PORT: String(apiPort),
      BANK_SITE_PORT: String(bankPort),
      BORROWER_PORT: String(borrowerPort),
      BANK_CONSOLE_PORT: String(staffPort),
      SIMULATION_DELAY_MS: "1",
      WORKER_POLL_MS: "100",
      PRIVATE_STORAGE_PATH: path.join(runDirectory, "uploads"),
      // Local browser tests always use the loopback URLs, including on CI hosts.
      WORKERS_CI: "0",
      KEYCADE_DEPLOYMENT: "local",
    };
    const config = path.join(runDirectory, "playwright.config.ts");
    writeFileSync(
      config,
      `import base from ${JSON.stringify(path.join(projectRoot, "playwright.config.ts"))};\nexport default { ...base, webServer: undefined, testDir: ${JSON.stringify(path.join(projectRoot, "tests/e2e"))}, fullyParallel: true, retries: 0 };\n`,
      { mode: 0o600 },
    );
    const cli = path.join(projectRoot, "node_modules/@playwright/test/cli.js");
    const listing = path.join(runDirectory, "tests.json");
    const listed = launch(
      [cli, "test", ...args, `--config=${config}`, "--list", "--reporter=json"],
      { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: listing },
      path.join(runDirectory, "listing.log"),
    );
    if ((await listed.done) !== 0)
      throw new RunnerError("Browser-test discovery failed. Check the private listing log.");
    const total = countTests((JSON.parse(readFileSync(listing, "utf8")) as Report).suites);
    if (!total) throw new RunnerError("No browser tests matched the supplied filters.");
    const runtimes = [
      launch(
        ["--import", "tsx", "apps/worker/src/index.ts"],
        env,
        path.join(runDirectory, "worker.log"),
      ),
      ...["bank-site", "borrower", "bank-console"].map((name) =>
        launch(
          [
            path.join(projectRoot, `apps/${name}/node_modules/vite/bin/vite.js`),
            "--host",
            "127.0.0.1",
          ],
          env,
          path.join(runDirectory, `${name}.log`),
          { cwd: path.join(projectRoot, `apps/${name}`) },
        ),
      ),
    ];
    const startApi = () =>
      launch(["--import", "tsx", "apps/api/src/index.ts"], env, path.join(runDirectory, "api.log"));
    let api = startApi();
    await ready(`http://127.0.0.1:${apiPort}/api/ready`, [...runtimes, api]);
    for (const port of [bankPort, borrowerPort, staffPort])
      await ready(`http://127.0.0.1:${port}`, runtimes);
    console.log(`Running ${total} browser tests in isolated sequential shards.`);
    const totals = { expected: 0, unexpected: 0, skipped: 0, flaky: 0 };
    for (let shard = 1; shard <= total; shard++) {
      abort.signal.throwIfAborted();
      if (shard > 1) {
        await stop(api);
        // Reset only this disposable database between tests. Real runtime limits stay enabled.
        await database.pool.query("UPDATE identity_rate_limits SET reset_at = '2000-01-01'");
        api = startApi();
        await ready(`http://127.0.0.1:${apiPort}/api/ready`, [...runtimes, api]);
      }
      const report = path.join(runDirectory, `shard-${shard}.json`);
      const result = launch(
        [
          cli,
          "test",
          ...args,
          `--config=${config}`,
          "--workers=1",
          `--shard=${shard}/${total}`,
          "--reporter=list,json",
          `--output=${path.join(runDirectory, `shard-${shard}`)}`,
        ],
        { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
        path.join(runDirectory, `shard-${shard}.log`),
      );
      const code = await result.done;
      abort.signal.throwIfAborted();
      const stats = (JSON.parse(readFileSync(report, "utf8")) as Report).stats;
      for (const key of ["expected", "unexpected", "skipped", "flaky"] as const)
        totals[key] += stats[key];
      if (code !== 0) {
        process.exitCode = 1;
        console.error(`Browser shard ${shard}/${total} failed. See its private log and report.`);
      }
      if (shard % 5 === 0) console.log(`Browser progress: ${shard}/${total} tests checked.`);
    }
    writeFileSync(path.join(runDirectory, "summary.json"), JSON.stringify(totals, null, 2), {
      mode: 0o600,
    });
    console.log(
      `Browser tests: ${totals.expected} passed, ${totals.skipped} skipped, ${totals.unexpected} failed, ${totals.flaky} flaky.`,
    );
  } finally {
    await Promise.all([...processes].map(stop));
    await database?.cleanup();
    console.log("Owned browser-test processes stopped and disposable database removed.");
  }
}
main().catch((error) => {
  if (!abort.signal.aborted) {
    console.error(
      error instanceof RunnerError
        ? error.message
        : "Isolated browser tests failed. Connection values omitted; check the private logs.",
    );
    process.exitCode = 1;
  }
});
