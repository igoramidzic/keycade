import type { UserConfig } from "vite";
import { readEnvironment } from "./server.ts";

// Read the root environment in Node; expose only these three explicit public URLs.
export function publicViteConfig({
  name,
  port,
}: {
  name: "bank-site" | "borrower" | "bank-console";
  port: number;
}): UserConfig {
  const env = readEnvironment();
  const key = {
    "bank-site": "BANK_SITE_PORT",
    borrower: "BORROWER_PORT",
    "bank-console": "BANK_CONSOLE_PORT",
  }[name];
  const numericPort = (value: string | undefined, fallback: number) => {
    const n = Number(value ?? fallback);
    if (!Number.isInteger(n) || n < 1024 || n > 65535)
      throw new Error("Invalid public port configuration.");
    return n;
  };
  return {
    envPrefix: [],
    define: {
      __KEYCADE_PUBLIC__: JSON.stringify({
        bankSiteUrl: `http://127.0.0.1:${numericPort(env.BANK_SITE_PORT, 3000)}`,
        borrowerUrl: `http://127.0.0.1:${numericPort(env.BORROWER_PORT, 3001)}`,
        bankConsoleUrl: `http://127.0.0.1:${numericPort(env.BANK_CONSOLE_PORT, 3002)}`,
      }),
    },
    server: {
      host: "127.0.0.1",
      port: numericPort(env[key], port),
      strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${numericPort(env.API_PORT, 4000)}` },
    },
    preview: { host: "127.0.0.1", port: numericPort(env[key], port), strictPort: true },
    resolve: { dedupe: ["react", "react-dom"] },
  };
}
