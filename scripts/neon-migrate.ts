import { runNeonMigrations, safeMigrationError } from "./neon-migrate-lib";

runNeonMigrations()
  .then(({ applied, total }) => {
    console.log(`Neon migrations complete: ${applied} applied; ${total} total.`);
  })
  .catch((error: unknown) => {
    console.error(safeMigrationError(error).message);
    process.exitCode = 1;
  });
