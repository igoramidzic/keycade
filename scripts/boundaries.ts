import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "@keycade/config/server";

const failures: string[] = [];
function inspect(folder: string) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (["node_modules", "dist", ".turbo"].includes(entry.name)) continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (/\.[tj]sx?$/.test(file)) {
      const source = readFileSync(file, "utf8");
      if (
        /(?:from\s*|import\s*\()\s*["'](?:@keycade\/(?:db|domain|integrations)|.*packages\/(?:db|domain|integrations)|.*config\/server)/.test(
          source,
        )
      )
        failures.push(path.relative(projectRoot, file));
      if (/import\.meta\.env\.(?!MODE|DEV|PROD|BASE_URL)/.test(source))
        failures.push(`${path.relative(projectRoot, file)}: non-allowlisted browser env`);
    }
  }
}
for (const dir of [
  "apps/bank-site/src",
  "apps/borrower/src",
  "apps/bank-console/src",
  "packages/ui/src",
  "packages/contracts/src",
])
  inspect(path.join(projectRoot, dir));
if (failures.length) throw new Error(`Browser/server boundary violations: ${failures.join(", ")}`);
console.log("Browser package boundaries passed.");
