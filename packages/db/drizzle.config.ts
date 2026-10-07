import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: fileURLToPath(new URL("./src/*schema.ts", import.meta.url)),
  out: relative(process.cwd(), fileURLToPath(new URL("./migrations", import.meta.url))),
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
