import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { parse } from "dotenv";
import { z } from "zod";

export const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const envFile = path.join(projectRoot, ".env");
export function readEnvironment(file = envFile): Record<string, string | undefined> {
  let values: Record<string, string> = {};
  try {
    values = parse(readFileSync(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { ...values, ...process.env };
}
const port = z.coerce.number().int().min(1024).max(65535);
const positive = z.coerce.number().int().positive();
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PROJECT_NAME: z.string().regex(/^keycade(?:-[a-z0-9-]+)?$/),
  PODMAN_MACHINE: z.string().regex(/^[a-zA-Z0-9_.-]+$/),
  DB_HOST: z.enum(["127.0.0.1", "localhost"]),
  DB_PORT: port,
  DB_NAME: z.string().regex(/^keycade(?:_[a-z0-9_]+)?$/),
  DB_USER: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  DB_PASSWORD: z.string().min(16),
  DATABASE_URL: z.string().url(),
  POSTGRES_IMAGE: z.string().regex(/^docker\.io\/library\/postgres:[a-zA-Z0-9.-]+$/),
  MAILPIT_IMAGE: z.string().regex(/^docker\.io\/axllent\/mailpit:[a-zA-Z0-9.-]+$/),
  MAILPIT_SMTP_PORT: port,
  MAILPIT_UI_PORT: port,
  API_PORT: port,
  BANK_SITE_PORT: port,
  BORROWER_PORT: port,
  BANK_CONSOLE_PORT: port,
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/),
  PRIVATE_STORAGE_PATH: z.string().min(1),
  DOCUMENT_MAX_FILE_BYTES: positive.max(100 * 1024 * 1024).default(25 * 1024 * 1024),
  DOCUMENT_MAX_BATCH_FILES: positive.max(100).default(10),
  SIMULATION_DELAY_MS: z.coerce.number().int().min(0).max(60000),
  PROVIDER_DEADLINE_MS: positive.max(120000),
  JOB_MAX_ATTEMPTS: positive.max(10),
  WORKER_POLL_MS: positive.min(100).max(10000),
  WORKER_HEARTBEAT_MS: positive.min(100),
  WORKER_STALE_MS: positive.min(1000),
});
export function loadServerEnv(values = readEnvironment()) {
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment: ${[...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ")}. Run pnpm initialize or compare .env.example. Values omitted.`,
    );
  }
  const env = parsed.data;
  const ports = [
    env.DB_PORT,
    env.MAILPIT_SMTP_PORT,
    env.MAILPIT_UI_PORT,
    env.API_PORT,
    env.BANK_SITE_PORT,
    env.BORROWER_PORT,
    env.BANK_CONSOLE_PORT,
  ];
  if (new Set(ports).size !== ports.length)
    throw new Error("Configured service ports must be distinct.");
  return {
    ...env,
    PRIVATE_STORAGE_PATH: path.resolve(projectRoot, env.PRIVATE_STORAGE_PATH),
    ALLOWED_ORIGINS: [env.BANK_SITE_PORT, env.BORROWER_PORT, env.BANK_CONSOLE_PORT].flatMap((p) => [
      `http://127.0.0.1:${p}`,
      `http://localhost:${p}`,
    ]),
  };
}
export type ServerEnv = ReturnType<typeof loadServerEnv>;
