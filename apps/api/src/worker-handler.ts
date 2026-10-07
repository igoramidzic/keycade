import {
  applicationParamsSchema,
  authSessionSchema,
  consumeAccessLinkResponseSchema,
  consumeAccessLinkSchema,
  demoSignInResponseSchema,
  demoSignInSchema,
  errorSchema,
  logoutResponseSchema,
  publicApplicationSchema,
  type Readiness,
  readinessSchema,
  requestAccessLinkResponseSchema,
  requestAccessLinkSchema,
  staffApplicationSchema,
  staffSessionSchema,
  updatePurposeSchema,
} from "@keycade/contracts";
import type { Database } from "@keycade/db";
import {
  createIdentityService,
  DomainError,
  readApplication,
  readStaffApplication,
  updateApplicationPurpose,
} from "@keycade/domain";
import { z } from "zod";
import {
  type Authentication,
  accessLinkMessage,
  authenticateSession,
  type IdentityTransportOptions,
  publicSession,
  readStaffSession,
} from "./auth.js";
import {
  configuredRequestOrigin,
  isAllowedOrigin,
  readSessionCookie,
  serializeSessionCookie,
  validCsrfToken,
} from "./security.js";

export interface WorkerDependencies extends IdentityTransportOptions {
  db: Database;
  allowedOrigins: readonly string[];
  rateLimiter: { limit(input: { key: string }): Promise<{ success: boolean }> };
  readiness(): Promise<Readiness>;
  authenticate?: (request: Request) => Promise<Authentication>;
}

/** Native Worker transport shares Node API contracts/services. Fastify's router requires runtime eval. */
export async function handleWorkerRequest(
  request: Request,
  deps: WorkerDependencies,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const headers = {
    "cache-control": "no-store",
    "x-request-id": requestId,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  const json = (value: unknown, status = 200, cookie?: string) => {
    const response = Response.json(value, {
      status,
      headers: cookie ? { ...headers, "set-cookie": cookie } : headers,
    });
    return request.method === "HEAD" ? new Response(null, response) : response;
  };
  const failure = (status: number, code: string, message: string) =>
    json({ error: { code, message, requestId } }, status);
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const originHeader = request.headers.get("origin") ?? undefined;
    const origin = configuredRequestOrigin(originHeader, url.origin, deps.allowedOrigins);
    const identity = createIdentityService(deps.db);
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
          "/api/v1/auth/session": { get: { responses: { "200": response(authSessionSchema) } } },
          "/api/v1/auth/staff": {
            get: {
              responses: { "200": response(staffSessionSchema), "404": response(errorSchema) },
            },
          },
          "/api/v1/auth/request-link": {
            post: {
              requestBody: {
                required: true,
                content: {
                  "application/json": { schema: z.toJSONSchema(requestAccessLinkSchema) },
                },
              },
              responses: {
                "202": response(requestAccessLinkResponseSchema),
                "400": response(errorSchema),
                "403": response(errorSchema),
                "429": response(errorSchema),
                "503": response(errorSchema),
              },
            },
          },
          "/api/v1/auth/demo-sign-in": {
            post: {
              requestBody: {
                required: true,
                content: { "application/json": { schema: z.toJSONSchema(demoSignInSchema) } },
              },
              responses: {
                "200": response(demoSignInResponseSchema),
                "400": response(errorSchema),
                "403": response(errorSchema),
                "404": response(errorSchema),
                "429": response(errorSchema),
                "503": response(errorSchema),
              },
            },
          },
          "/api/v1/auth/consume": {
            post: {
              requestBody: {
                required: true,
                content: {
                  "application/json": { schema: z.toJSONSchema(consumeAccessLinkSchema) },
                },
              },
              responses: {
                "200": response(consumeAccessLinkResponseSchema),
                "400": response(errorSchema),
                "403": response(errorSchema),
                "429": response(errorSchema),
              },
            },
          },
          "/api/v1/auth/logout": {
            post: {
              responses: { "200": response(logoutResponseSchema), "403": response(errorSchema) },
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
    const authentication = deps.authenticate
      ? await deps.authenticate(request)
      : await authenticateSession(
          identity,
          request.headers.get("cookie") ?? undefined,
          origin,
          deps.demoSignInEnabled,
        );
    if (
      !get &&
      request.method !== "OPTIONS" &&
      authentication.actor.kind === "user" &&
      !validCsrfToken(request.headers.get("x-csrf-token"), authentication.csrfToken)
    ) {
      return failure(403, "FORBIDDEN", "Invalid request verification.");
    }
    if (get && path === "/api/v1/auth/session")
      return json(authSessionSchema.parse(publicSession(authentication, deps.demoSignInEnabled)));
    if (get && path === "/api/v1/auth/staff")
      return json(staffSessionSchema.parse(await readStaffSession(deps.db, authentication)));
    if (request.method === "POST" && path === "/api/v1/auth/request-link") {
      const body = requestAccessLinkSchema.parse(await readJsonBody(request));
      if (deps.authDeliveryEnabled === false)
        return failure(
          503,
          "AUTH_DELIVERY_UNAVAILABLE",
          "Email sign-in is available in the local demo. Hosted email delivery is not configured.",
        );
      if (!originHeader || !isAllowedOrigin(originHeader, deps.portalOrigins?.[body.portal] ?? []))
        return failure(403, "FORBIDDEN", "Request origin is not allowed for this portal.");
      await identity.requestAccessLink({
        ...body,
        origin: originHeader,
        requestId,
        rateLimitKey: request.headers.get("cf-connecting-ip") ?? "unknown",
      });
      return json({ message: accessLinkMessage }, 202);
    }
    if (request.method === "POST" && path === "/api/v1/auth/demo-sign-in") {
      const body = demoSignInSchema.parse(await readJsonBody(request));
      if (deps.demoSignInEnabled !== true)
        return failure(
          503,
          "DEMO_SIGN_IN_UNAVAILABLE",
          "Immediate demo sign-in is unavailable in this environment.",
        );
      if (!originHeader || !isAllowedOrigin(originHeader, deps.portalOrigins?.[body.portal] ?? []))
        return failure(403, "FORBIDDEN", "Request origin is not allowed for this portal.");
      const result = await identity.signInDemo({
        ...body,
        origin: originHeader,
        requestId,
        rateLimitKey: request.headers.get("cf-connecting-ip") ?? "unknown",
      });
      return json(
        demoSignInResponseSchema.parse({ returnPath: result.returnPath }),
        200,
        serializeSessionCookie(originHeader, result.sessionToken, deps.nodeEnv ?? "production"),
      );
    }
    if (request.method === "POST" && path === "/api/v1/auth/consume") {
      const body = consumeAccessLinkSchema.parse(await readJsonBody(request));
      if (!originHeader) return failure(403, "FORBIDDEN", "Request origin is not allowed.");
      const result = await identity.consumeAccessLink({
        ...body,
        origin: originHeader,
        requestId,
        rateLimitKey: request.headers.get("cf-connecting-ip") ?? "unknown",
      });
      return json(
        consumeAccessLinkResponseSchema.parse({ returnPath: result.returnPath }),
        200,
        serializeSessionCookie(originHeader, result.sessionToken, deps.nodeEnv ?? "production"),
      );
    }
    if (request.method === "POST" && path === "/api/v1/auth/logout") {
      if (!originHeader) return failure(403, "FORBIDDEN", "Request origin is not allowed.");
      const raw = readSessionCookie(request.headers.get("cookie") ?? undefined, originHeader);
      if (raw && authentication.session) await identity.revokeSession(raw, requestId);
      return json(
        { ok: true },
        200,
        serializeSessionCookie(originHeader, "", deps.nodeEnv ?? "production"),
      );
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
    const actor = authentication.actor;
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
    const input = await readJsonBody(request);
    const body = updatePurposeSchema.safeParse(input);
    if (!body.success) return failure(400, "INVALID_INPUT", "Invalid request.");
    return json(
      publicApplicationSchema.parse(
        await updateApplicationPurpose(deps.db, actor, bankId, applicationId, body.data, requestId),
      ),
    );
  } catch (error) {
    if (error instanceof DomainError) return failure(error.statusCode, error.code, error.message);
    if (error instanceof z.ZodError) return failure(400, "INVALID_INPUT", "Invalid request.");
    // Database/provider errors can contain confidential values; never log raw exceptions.
    console.warn("Worker request failed.");
    return failure(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw new DomainError("INVALID_INPUT", 413, "Invalid request.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  }
}
