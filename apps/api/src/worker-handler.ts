import {
  applicationParamsSchema,
  publicApplicationSchema,
  type Readiness,
  readinessSchema,
  staffApplicationSchema,
  updatePurposeSchema,
} from "@keycade/contracts";
import type { Database } from "@keycade/db";
import {
  DomainError,
  readApplication,
  readStaffApplication,
  updateApplicationPurpose,
} from "@keycade/domain";
import { z } from "zod";
import { isAllowedOrigin } from "./security";

interface Dependencies {
  db: Database;
  allowedOrigins: readonly string[];
  rateLimiter: { limit(input: { key: string }): Promise<{ success: boolean }> };
  readiness(): Promise<Readiness>;
}

/** Native Worker transport shares Node API contracts/services. Fastify's router requires runtime eval. */
export async function handleWorkerRequest(request: Request, deps: Dependencies): Promise<Response> {
  const requestId = crypto.randomUUID();
  const headers = {
    "cache-control": "no-store",
    "x-request-id": requestId,
    "x-content-type-options": "nosniff",
  };
  const json = (value: unknown, status = 200) => {
    const response = Response.json(value, { status, headers });
    return request.method === "HEAD" ? new Response(null, response) : response;
  };
  const failure = (status: number, code: string, message: string) =>
    json({ error: { code, message, requestId } }, status);
  try {
    const path = new URL(request.url).pathname;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !isAllowedOrigin(request.headers.get("origin") ?? undefined, deps.allowedOrigins)
    )
      return failure(403, "FORBIDDEN", "Request origin is not allowed.");
    if (!["/api/health", "/api/ready"].includes(path)) {
      const limit = await deps.rateLimiter.limit({
        key: request.headers.get("cf-connecting-ip") ?? "unknown",
      });
      if (!limit.success)
        return failure(429, "RATE_LIMITED", "Too many requests. Try again later.");
    }
    const get = request.method === "GET" || request.method === "HEAD";
    if (get && path === "/api/health") return json({ status: "ok", simulation: true });
    if (get && path === "/api/ready") {
      try {
        const result = readinessSchema.parse(await deps.readiness());
        return json(result, result.status === "ready" ? 200 : 503);
      } catch {
        return json(
          { status: "not_ready", database: "unavailable", worker: "unavailable", simulation: true },
          503,
        );
      }
    }
    if (get && path === "/api/openapi.json") {
      const parameters = ["bankId", "applicationId"].map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      }));
      const response = (schema: z.ZodType) => ({
        description: "Success",
        content: { "application/json": { schema: z.toJSONSchema(schema) } },
      });
      return json({
        openapi: "3.1.0",
        info: { title: "Keycade simulation API", version: "0.1.0" },
        paths: {
          "/api/health": {
            get: {
              responses: {
                "200": response(z.object({ status: z.literal("ok"), simulation: z.literal(true) })),
              },
            },
          },
          "/api/ready": {
            get: {
              responses: { "200": response(readinessSchema), "503": response(readinessSchema) },
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}": {
            get: { parameters, responses: { "200": response(publicApplicationSchema) } },
          },
          "/api/v1/banks/{bankId}/staff/applications/{applicationId}": {
            get: { parameters, responses: { "200": response(staffApplicationSchema) } },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/purpose": {
            patch: {
              parameters,
              requestBody: {
                required: true,
                content: { "application/json": { schema: z.toJSONSchema(updatePurposeSchema) } },
              },
              responses: { "200": response(publicApplicationSchema) },
            },
          },
        },
      });
    }
    const match = /^\/api\/v1\/banks\/([^/]+)\/(staff\/)?applications\/([^/]+)(\/purpose)?$/.exec(
      path,
    );
    if (
      !match ||
      (!get && request.method !== "PATCH") ||
      (get && match[4]) ||
      (request.method === "PATCH" && (!match[4] || match[2]))
    )
      return failure(404, "NOT_FOUND", "Resource not found.");
    const params = applicationParamsSchema.safeParse({ bankId: match[1], applicationId: match[3] });
    if (!params.success) return failure(400, "INVALID_INPUT", "Invalid request.");
    // T06 must wire its trusted session resolver into both transports; no header grants identity.
    const actor = { kind: "anonymous" } as const;
    const { bankId, applicationId } = params.data;
    if (get) {
      if (match[2])
        return json(
          staffApplicationSchema.parse(
            await readStaffApplication(deps.db, actor, bankId, applicationId),
          ),
        );
      return json(
        publicApplicationSchema.parse(await readApplication(deps.db, actor, bankId, applicationId)),
      );
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return failure(400, "INVALID_INPUT", "Invalid request.");
    const reader = request.body?.getReader();
    if (!reader) return failure(400, "INVALID_INPUT", "Invalid request.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64 * 1024) {
          await reader.cancel();
          return failure(413, "INVALID_INPUT", "Invalid request.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let input: unknown;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return failure(400, "INVALID_INPUT", "Invalid request.");
    }
    const body = updatePurposeSchema.safeParse(input);
    if (!body.success) return failure(400, "INVALID_INPUT", "Invalid request.");
    return json(
      publicApplicationSchema.parse(
        await updateApplicationPurpose(deps.db, actor, bankId, applicationId, body.data, requestId),
      ),
    );
  } catch (error) {
    if (error instanceof DomainError) return failure(error.statusCode, error.code, error.message);
    // Database/provider errors can contain confidential values; never log raw exceptions.
    console.warn("Worker request failed.");
    return failure(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
