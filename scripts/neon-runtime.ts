import { Client } from "pg";
import { neonClientConfig } from "./neon-migrate-lib";
import { configureRuntimeRole } from "./neon-runtime-lib";

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("GitHub Actions required.");
  const client = new Client(neonClientConfig(process.env));
  try {
    await client.connect();
    await configureRuntimeRole(client, process.env.NEON_RUNTIME_PASSWORD ?? "");
    console.log("Neon runtime role configured; schema administration and audit edits denied.");
  } finally {
    await client.end();
  }
}
main().catch(() => {
  console.error("Neon runtime role setup failed. Check the approved CI target and credential.");
  process.exitCode = 1;
});
