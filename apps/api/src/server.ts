import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  applicationParamsSchema,
  errorSchema,
  publicApplicationSchema,
  type Readiness,
  readinessSchema,
  staffApplicationSchema,
  updatePurposeSchema,
} from "@keycade/contracts";
import type { Database } from "@keycade/db";
import {
  type Actor,
  DomainError,
  readApplication,
  readStaffApplication,
  updateApplicationPurpose,
} from "@keycade/domain";
import Fastify, { type FastifyRequest, LogController } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { isAllowedOrigin, validCsrfToken } from "./security.js";

interface Authentication {
  actor: Actor;
  csrfToken?: string;
}
declare module "fastify" {
  interface FastifyRequest {
    authentication: Authentication;
  }
}

export interface ServerOptions {
  db: Database;
  allowedOrigins: readonly string[];
  readiness: () => Promise<Readiness>;
  logger?: boolean;
  // Internal dependency injection. T06 connects its session resolver here; no request header grants identity.
  authenticate?: (request: FastifyRequest) => Promise<Authentication>;
}

export async function buildServer(options: ServerOptions) {
  const app = Fastify({
    logger: options.logger
      ? {
          redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
          serializers: {
            req: (request) => ({ method: request.method }),
            res: (reply) => ({ statusCode: reply.statusCode }),
          },
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 64 * 1024,
    trustProxy: false,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("authentication");
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: { info: { title: "Keycade local simulation API", version: "0.1.0" } },
    transform: jsonSchemaTransform,
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !isAllowedOrigin(request.headers.origin, options.allowedOrigins)
    ) {
      return reply.code(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Request origin is not allowed.",
          requestId: request.id,
        },
      });
    }
  });
  app.addHook("preHandler", async (request, reply) => {
    if (
      ["/api/health", "/api/ready", "/api/openapi.json"].includes(request.routeOptions.url ?? "")
    ) {
      request.authentication = { actor: { kind: "anonymous" } };
      return;
    }
    request.authentication = options.authenticate
      ? await options.authenticate(request)
      : { actor: { kind: "anonymous" } };
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.authentication.actor.kind === "user" &&
      !validCsrfToken(request.headers["x-csrf-token"], request.authentication.csrfToken)
    ) {
      return reply.code(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Invalid request verification.",
          requestId: request.id,
        },
      });
    }
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      { method: request.method, route: request.routeOptions.url, statusCode: reply.statusCode },
      "request completed",
    );
  });
  app.setErrorHandler((error, request, reply) => {
    reply.header("x-request-id", request.id);
    const transportError = (error && typeof error === "object" ? error : {}) as {
      validation?: unknown;
      statusCode?: number;
    };
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "The request could not be completed.";
    if (error instanceof DomainError) {
      status = error.statusCode;
      code = error.code;
      message = error.message;
    } else if (
      transportError.validation ||
      transportError.statusCode === 400 ||
      transportError.statusCode === 413 ||
      transportError.statusCode === 415
    ) {
      status = transportError.statusCode === 413 ? 413 : 400;
      code = "INVALID_INPUT";
      message = "Invalid request.";
    } else if (transportError.statusCode === 429) {
      status = 429;
      code = "RATE_LIMITED";
      message = "Too many requests. Try again later.";
    }
    // Never log error objects: SQL/validation/provider errors may contain confidential input.
    request.log.warn({ code, statusCode: status }, "request failed");
    reply.code(status).send({ error: { code, message, requestId: request.id } });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: "NOT_FOUND", message: "Resource not found.", requestId: request.id },
    }),
  );
  app.get(
    "/api/health",
    {
      config: { rateLimit: false },
      schema: {
        response: { 200: z.object({ status: z.literal("ok"), simulation: z.literal(true) }) },
      },
    },
    async () => ({ status: "ok" as const, simulation: true as const }),
  );
  app.get(
    "/api/ready",
    {
      config: { rateLimit: false },
      schema: { response: { 200: readinessSchema, 503: readinessSchema } },
    },
    async (_request, reply) => {
      let status: Readiness;
      try {
        status = await options.readiness();
      } catch {
        status = {
          status: "not_ready",
          database: "unavailable",
          worker: "unavailable",
          simulation: true,
        };
      }
      return reply.code(status.status === "ready" ? 200 : 503).send(status);
    },
  );
  app.get("/api/openapi.json", { config: { rateLimit: false }, schema: { hide: true } }, async () =>
    app.swagger(),
  );
  const responses = {
    400: errorSchema,
    403: errorSchema,
    404: errorSchema,
    409: errorSchema,
    429: errorSchema,
    500: errorSchema,
  };
  app.get(
    "/api/v1/banks/:bankId/applications/:applicationId",
    {
      schema: {
        params: applicationParamsSchema,
        response: { 200: publicApplicationSchema, ...responses },
      },
    },
    async (request) =>
      readApplication(
        options.db,
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
      ),
  );
  app.get(
    "/api/v1/banks/:bankId/staff/applications/:applicationId",
    {
      schema: {
        params: applicationParamsSchema,
        response: { 200: staffApplicationSchema, ...responses },
      },
    },
    async (request) =>
      readStaffApplication(
        options.db,
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
      ),
  );
  app.patch(
    "/api/v1/banks/:bankId/applications/:applicationId/purpose",
    {
      schema: {
        params: applicationParamsSchema,
        body: updatePurposeSchema,
        response: { 200: publicApplicationSchema, ...responses },
      },
    },
    async (request) =>
      updateApplicationPurpose(
        options.db,
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
        request.body,
        request.id,
      ),
  );
  return app;
}
