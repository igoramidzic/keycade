import type { ExportedHandler, Fetcher } from "@cloudflare/workers-types";

interface FrontendBindings {
  ASSETS: Fetcher;
  API: Fetcher;
}

/** Server-side proxy: browsers use their own origin and never receive a backend credential. */
export const frontendWorker: ExportedHandler<FrontendBindings> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return env.API.fetch(request);
    return env.ASSETS.fetch(request);
  },
};
