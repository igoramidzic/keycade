import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  acceptInvitationResponseSchema,
  addBusinessRelationshipSchema,
  addStaffNoteSchema,
  applicationPageSchema,
  applicationParamsSchema,
  applicationPortalSchema,
  applicationSelectionSchema,
  applicationSetupSchema,
  assignStaffSchema,
  assignTaskSchema,
  authorizeTaxSchema,
  authSessionSchema,
  bankParamsSchema,
  beginDocumentBatchSchema,
  claimApplicationSchema,
  confirmEnrichmentFactSchema,
  consumeAccessLinkResponseSchema,
  consumeAccessLinkSchema,
  correctDocumentCategorySchema,
  createDraftSchema,
  createInvitationSchema,
  createManualTaskSchema,
  demoSignInResponseSchema,
  demoSignInSchema,
  documentsViewSchema,
  documentUploadResultSchema,
  enrichmentSubjectSchema,
  enrichmentViewSchema,
  errorSchema,
  finishApplicationSetupSchema,
  invitationViewSchema,
  linkRelationshipSchema,
  logoutResponseSchema,
  pageQuerySchema,
  participantCommandSchema,
  participantsWorkspaceSchema,
  publicApplicationSchema,
  publicIntakeParamsSchema,
  publicIntakeQuerySchema,
  publicIntakeSchema,
  publicStartApplicationSchema,
  type Readiness,
  readinessSchema,
  requestAccessLinkResponseSchema,
  requestAccessLinkSchema,
  requestEnrichmentSchema,
  retryEnrichmentSchema,
  reviewTaskSchema,
  saveApplicationSetupSchema,
  saveIdentifierSchema,
  saveTaskAnswerSchema,
  setRelationshipActiveSchema,
  staffApplicationPageSchema,
  staffApplicationSchema,
  staffNoteParamsSchema,
  staffOptionsSchema,
  staffPageQuerySchema,
  staffSessionSchema,
  staffWorkspaceSchema,
  taskRevisionSchema,
  tasksViewSchema,
  taskViewSchema,
  updatePurposeSchema,
  updateStaffNoteSchema,
  waiveTaskSchema,
} from "@keycade/contracts";
import type { Database } from "@keycade/db";
import {
  addStaffNote,
  assignApplicationStaff,
  createApplicationService,
  createEnrichmentService,
  createIdentifierCipher,
  createIdentityService,
  createParticipantsService,
  createTasksService,
  DomainError,
  listStaffApplications,
  readApplication,
  readPublicIntake,
  readStaffApplication,
  readStaffOptions,
  readStaffWorkspace,
  requireBankStaff,
  updateApplicationPurpose,
  updateStaffNote,
} from "@keycade/domain";
import { type ByteSource, webByteSource } from "@keycade/integrations/documents";
import Fastify, { type FastifyRequest, LogController } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import {
  type Authentication,
  accessLinkMessage,
  assertExpectedSession,
  assertSessionBank,
  authenticateSession,
  type IdentityTransportOptions,
  publicSession,
  readStaffSession,
} from "./auth.js";
import { createDocumentTransport, type DocumentTransportOptions } from "./documents.js";
import {
  authConsumeRateLimit,
  authSendRateLimit,
  configuredRequestOrigin,
  isAllowedOrigin,
  readSessionCookie,
  serializeSessionCookie,
  validCsrfToken,
} from "./security.js";
import { isServiceUnavailable, serviceUnavailableMessage } from "./service-errors.js";

import {
  createWorkflowTransport,
  signatureWebhookContentType,
  signatureWebhookPath,
} from "./workflows.js";

declare module "fastify" {
  interface FastifyRequest {
    authentication: Authentication;
  }
}

export interface ServerOptions extends IdentityTransportOptions, DocumentTransportOptions {
  db: Database;
  encryptionKey?: string;
  allowedOrigins: readonly string[];
  readiness: () => Promise<Readiness>;
  logger?: boolean;
  // Internal test injection; runtime identity is resolved only from server-side sessions.
  authenticate?: (request: FastifyRequest) => Promise<Authentication>;
}

export async function buildServer(options: ServerOptions) {
  const identity = createIdentityService(options.db);
  const applications = createApplicationService(options.db, {
    requireStaffContinuation: true,
    staffContinuationOrigin:
      options.authDeliveryEnabled === false ? undefined : options.portalOrigins?.borrower?.[0],
  });
  const participants = createParticipantsService(options.db, {
    borrowerOrigin: options.portalOrigins?.borrower?.[0] ?? "http://localhost:3001",
    deliveryEnabled:
      options.authDeliveryEnabled !== false && !!options.portalOrigins?.borrower?.[0],
  });
  const tasks = createTasksService(options.db);
  const workflows = createWorkflowTransport(options.db, options);
  const documentTransport = createDocumentTransport(options.db, options);
  const enrichment = () => {
    if (!options.encryptionKey)
      throw new DomainError(
        "ENRICHMENT_UNAVAILABLE",
        503,
        "Private enrichment is unavailable in this environment.",
      );
    return createEnrichmentService(options.db, {
      cipher: createIdentifierCipher(options.encryptionKey),
    });
  };
  const originFor = (request: FastifyRequest) =>
    configuredRequestOrigin(
      request.headers.origin,
      `${request.protocol}://${request.host}`,
      options.allowedOrigins,
    );
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            'req.headers["x-csrf-token"]',
            'req.headers["x-keycade-session"]',
            "res.headers.set-cookie",
          ],
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
  app.addContentTypeParser("application/octet-stream", (_request, payload, done) =>
    done(null, payload),
  );
  app.addContentTypeParser(
    signatureWebhookContentType,
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );
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
    reply.header("referrer-policy", "no-referrer");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !(request.method === "POST" && request.url.split("?")[0] === signatureWebhookPath) &&
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
      [
        signatureWebhookPath,
        "/api/health",
        "/api/ready",
        "/api/openapi.json",
        "/api/v1/public/banks/:bankSlug/intake",
      ].includes(request.routeOptions.url ?? "")
    ) {
      request.authentication = { actor: { kind: "anonymous" } };
      return;
    }
    request.authentication = options.authenticate
      ? await options.authenticate(request)
      : await authenticateSession(
          identity,
          request.headers.cookie,
          originFor(request),
          options.demoSignInEnabled,
        );
    assertExpectedSession(request.authentication, request.headers["x-keycade-session"]);
    if (request.headers["x-keycade-session"]) reply.header("x-keycade-session-bound", "1");
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
    } else if (isServiceUnavailable(error)) {
      status = 503;
      code = "SERVICE_UNAVAILABLE";
      message = serviceUnavailableMessage;
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
  app.get(
    "/api/v1/public/banks/:bankSlug/intake",
    {
      schema: {
        params: publicIntakeParamsSchema,
        querystring: publicIntakeQuerySchema,
        response: {
          200: publicIntakeSchema,
          400: errorSchema,
          404: errorSchema,
          429: errorSchema,
          500: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (request) => readPublicIntake(options.db, request.params),
  );
  const responses = {
    400: errorSchema,
    403: errorSchema,
    404: errorSchema,
    409: errorSchema,
    429: errorSchema,
    500: errorSchema,
    503: errorSchema,
  };
  app.post(
    signatureWebhookPath,
    {
      schema: {
        body: z.string(),
        response: { 200: z.object({ ok: z.literal(true) }), ...responses },
      },
    },
    async (request) => {
      const signature = request.headers["x-keycade-signature"];
      return workflows.webhook(
        request.body,
        typeof signature === "string" ? signature : undefined,
        request.id,
      );
    },
  );
  for (const route of workflows.routes) {
    app.route({
      method: route.method,
      url: route.path,
      schema: {
        params: route.params,
        ...(route.body ? { body: route.body } : {}),
        ...(route.query ? { querystring: route.query } : {}),
        response: { 200: route.response, ...responses },
      },
      handler: async (request, reply) => {
        const params = route.params.parse(request.params);
        assertSessionBank(request.authentication, params.bankId);
        const result = route.response.parse(
          await route.handle({
            actor: request.authentication.actor,
            params,
            input: route.query ? route.query.parse(request.query) : request.body,
            requestId: request.id,
          }),
        );
        if (route.download)
          reply
            .type("text/plain; charset=utf-8")
            .header("content-disposition", 'attachment; filename="simulated-signature.txt"')
            .header("content-security-policy", "sandbox");
        return reply.send(result);
      },
    });
  }
  app.get(
    "/api/v1/auth/session",
    {
      // Session preflights are frequent reads; isolate their budget from application navigation.
      config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
      schema: { response: { 200: authSessionSchema, ...responses } },
    },
    async (request) =>
      publicSession(request.authentication, options.demoSignInEnabled, options.demoInboxEnabled),
  );
  app.get(
    "/api/v1/auth/staff",
    {
      schema: { response: { 200: staffSessionSchema, ...responses } },
    },
    async (request) => readStaffSession(options.db, request.authentication),
  );
  app.post(
    "/api/v1/auth/request-link",
    {
      config: { rateLimit: authSendRateLimit },
      schema: {
        body: requestAccessLinkSchema,
        response: { 202: requestAccessLinkResponseSchema, ...responses },
      },
    },
    async (request, reply) => {
      if (options.authDeliveryEnabled === false)
        return reply.code(503).send({
          error: {
            code: "AUTH_DELIVERY_UNAVAILABLE",
            message:
              "Email sign-in is available in the local demo. Hosted email delivery is not configured.",
            requestId: request.id,
          },
        });
      const origin = request.headers.origin;
      if (!origin || !isAllowedOrigin(origin, options.portalOrigins?.[request.body.portal] ?? []))
        return reply.code(403).send({
          error: {
            code: "FORBIDDEN",
            message: "Request origin is not allowed for this portal.",
            requestId: request.id,
          },
        });
      await identity.requestAccessLink({
        ...request.body,
        origin,
        requestId: request.id,
        rateLimitKey: request.ip,
      });
      return reply.code(202).send({ message: accessLinkMessage });
    },
  );
  app.post(
    "/api/v1/auth/demo-sign-in",
    {
      config: { rateLimit: authConsumeRateLimit },
      schema: { body: demoSignInSchema, response: { 200: demoSignInResponseSchema, ...responses } },
    },
    async (request, reply) => {
      if (options.demoSignInEnabled !== true)
        return reply.code(503).send({
          error: {
            code: "DEMO_SIGN_IN_UNAVAILABLE",
            message: "Immediate demo sign-in is unavailable in this environment.",
            requestId: request.id,
          },
        });
      const origin = request.headers.origin;
      if (!origin || !isAllowedOrigin(origin, options.portalOrigins?.[request.body.portal] ?? []))
        return reply.code(403).send({
          error: {
            code: "FORBIDDEN",
            message: "Request origin is not allowed for this portal.",
            requestId: request.id,
          },
        });
      const result = await identity.signInDemo({
        ...request.body,
        origin,
        requestId: request.id,
        rateLimitKey: request.ip,
      });
      reply.header(
        "set-cookie",
        serializeSessionCookie(origin, result.sessionToken, options.nodeEnv ?? "production"),
      );
      return demoSignInResponseSchema.parse({ returnPath: result.returnPath });
    },
  );
  app.post(
    "/api/v1/auth/consume",
    {
      config: { rateLimit: authConsumeRateLimit },
      schema: {
        body: consumeAccessLinkSchema,
        response: { 200: consumeAccessLinkResponseSchema, ...responses },
      },
    },
    async (request, reply) => {
      // onRequest already requires the exact configured Origin on every mutation.
      const origin = request.headers.origin;
      if (!origin) throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
      const result = await identity.consumeAccessLink({
        ...request.body,
        origin,
        requestId: request.id,
        rateLimitKey: request.ip,
      });
      reply.header(
        "set-cookie",
        serializeSessionCookie(origin, result.sessionToken, options.nodeEnv ?? "production"),
      );
      return consumeAccessLinkResponseSchema.parse({ returnPath: result.returnPath });
    },
  );
  app.post(
    "/api/v1/auth/logout",
    {
      schema: { response: { 200: logoutResponseSchema, ...responses } },
    },
    async (request, reply) => {
      const origin = request.headers.origin;
      if (!origin) throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
      const raw = readSessionCookie(request.headers.cookie, origin);
      if (raw && request.authentication.session) await identity.revokeSession(raw, request.id);
      reply.header(
        "set-cookie",
        serializeSessionCookie(origin, "", options.nodeEnv ?? "production"),
      );
      return { ok: true as const };
    },
  );
  app.post(
    "/api/v1/applications/start",
    {
      config: { rateLimit: authSendRateLimit },
      schema: {
        body: publicStartApplicationSchema,
        response: { 202: requestAccessLinkResponseSchema, ...responses },
      },
    },
    async (request, reply) => {
      if (options.authDeliveryEnabled === false)
        return reply.code(503).send({
          error: {
            code: "AUTH_DELIVERY_UNAVAILABLE",
            message:
              "Email sign-in is available in the local demo. Hosted email delivery is not configured.",
            requestId: request.id,
          },
        });
      const origin = request.headers.origin;
      if (!origin || !isAllowedOrigin(origin, options.portalOrigins?.borrower ?? []))
        return reply.code(403).send({
          error: {
            code: "FORBIDDEN",
            message: "Request origin is not allowed for this portal.",
            requestId: request.id,
          },
        });
      const result = await applications.publicStart(request.body, {
        origin,
        requestId: request.id,
        rateLimitKey: request.ip,
      });
      return reply.code(202).send(result);
    },
  );
  app.get(
    "/api/v1/banks/:bankId/applications",
    {
      schema: {
        params: bankParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: applicationPageSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return applications.list(request.authentication.actor, request.params.bankId, request.query);
    },
  );
  app.post(
    "/api/v1/banks/:bankId/applications",
    {
      schema: {
        params: bankParamsSchema,
        body: createDraftSchema,
        response: { 200: applicationSetupSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return applications.create(
        request.authentication.actor,
        request.params.bankId,
        request.body,
        request.id,
      );
    },
  );
  app.get(
    "/api/v1/banks/:bankId/applications/:applicationId/setup",
    {
      schema: {
        params: applicationParamsSchema,
        response: { 200: applicationSetupSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return applications.readSetup(
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
      );
    },
  );
  app.patch(
    "/api/v1/banks/:bankId/applications/:applicationId/setup",
    {
      schema: {
        params: applicationParamsSchema,
        body: saveApplicationSetupSchema,
        response: { 200: applicationSetupSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return applications.saveSetup(
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
        request.body,
        request.id,
      );
    },
  );
  app.post(
    "/api/v1/banks/:bankId/applications/:applicationId/setup/finish",
    {
      schema: {
        params: applicationParamsSchema,
        body: finishApplicationSetupSchema,
        response: { 200: applicationSetupSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return applications.finishSetup(
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
        request.body,
        request.id,
      );
    },
  );
  app.post(
    "/api/v1/banks/:bankId/applications/:applicationId/claim",
    {
      schema: {
        params: applicationParamsSchema,
        body: claimApplicationSchema,
        response: { 200: applicationSetupSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return applications.claim(
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
        request.id,
      );
    },
  );
  app.get(
    "/api/v1/banks/:bankId/applications/:applicationId/destination",
    {
      schema: {
        params: applicationParamsSchema,
        response: { 200: applicationSelectionSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return applications.destination(
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
      );
    },
  );
  app.get(
    "/api/v1/banks/:bankId/applications/:applicationId/portal",
    {
      schema: {
        params: applicationParamsSchema,
        response: { 200: applicationPortalSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return applications.portal(
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
      );
    },
  );
  app.get(
    "/api/v1/banks/:bankId/applications/:applicationId",
    {
      schema: {
        params: applicationParamsSchema,
        response: { 200: publicApplicationSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return readApplication(
        options.db,
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
      );
    },
  );
  app.get(
    "/api/v1/banks/:bankId/staff/applications/:applicationId",
    {
      schema: {
        params: applicationParamsSchema,
        response: { 200: staffApplicationSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return readStaffApplication(
        options.db,
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
      );
    },
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
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return updateApplicationPurpose(
        options.db,
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
        request.body,
        request.id,
      );
    },
  );
  const staffBase = "/api/v1/banks/:bankId/staff";
  app.get(
    `${staffBase}/options`,
    {
      schema: { params: bankParamsSchema, response: { 200: staffOptionsSchema, ...responses } },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return readStaffOptions(options.db, request.authentication.actor, request.params.bankId);
    },
  );
  app.get(
    `${staffBase}/applications`,
    {
      schema: {
        params: bankParamsSchema,
        querystring: staffPageQuerySchema,
        response: { 200: staffApplicationPageSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return listStaffApplications(
        options.db,
        request.authentication.actor,
        request.params.bankId,
        request.query,
      );
    },
  );
  app.post(
    `${staffBase}/applications`,
    {
      schema: {
        params: bankParamsSchema,
        body: createDraftSchema,
        response: { 200: applicationSetupSchema, ...responses },
      },
    },
    async (request, reply) => {
      const { bankId } = request.params;
      assertSessionBank(request.authentication, bankId);
      await requireBankStaff(options.db, request.authentication.actor, bankId);
      if (options.authDeliveryEnabled === false || !options.portalOrigins?.borrower?.[0])
        return reply.code(503).send({
          error: {
            code: "AUTH_DELIVERY_UNAVAILABLE",
            message: "Application continuation email is unavailable in this environment.",
            requestId: request.id,
          },
        });
      return applications.create(request.authentication.actor, bankId, request.body, request.id);
    },
  );
  app.get(
    `${staffBase}/applications/:applicationId/workspace`,
    {
      schema: {
        params: applicationParamsSchema,
        response: { 200: staffWorkspaceSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return readStaffWorkspace(
        options.db,
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
      );
    },
  );
  app.get(
    `${staffBase}/applications/:applicationId/setup`,
    {
      schema: {
        params: applicationParamsSchema,
        response: { 200: applicationSetupSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      await requireBankStaff(options.db, request.authentication.actor, request.params.bankId);
      return applications.readSetup(
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
      );
    },
  );
  app.patch(
    `${staffBase}/applications/:applicationId/setup`,
    {
      schema: {
        params: applicationParamsSchema,
        body: saveApplicationSetupSchema,
        response: { 200: applicationSetupSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      await requireBankStaff(options.db, request.authentication.actor, request.params.bankId);
      return applications.saveSetup(
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
        request.body,
        request.id,
      );
    },
  );
  app.patch(
    `${staffBase}/applications/:applicationId/assignment`,
    {
      schema: {
        params: applicationParamsSchema,
        body: assignStaffSchema,
        response: { 200: staffWorkspaceSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return assignApplicationStaff(
        options.db,
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
        request.body,
        request.id,
      );
    },
  );
  app.post(
    `${staffBase}/applications/:applicationId/notes`,
    {
      schema: {
        params: applicationParamsSchema,
        body: addStaffNoteSchema,
        response: { 200: staffWorkspaceSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return addStaffNote(
        options.db,
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
        request.body,
        request.id,
      );
    },
  );
  app.patch(
    `${staffBase}/applications/:applicationId/notes/:noteId`,
    {
      schema: {
        params: staffNoteParamsSchema,
        body: updateStaffNoteSchema,
        response: { 200: staffWorkspaceSchema, ...responses },
      },
    },
    async (request) => {
      assertSessionBank(request.authentication, request.params.bankId);
      return updateStaffNote(
        options.db,
        request.authentication.actor,
        request.params.bankId,
        request.params.applicationId,
        request.params.noteId,
        request.body,
        request.id,
      );
    },
  );
  const documentsBase = "/api/v1/banks/:bankId/applications/:applicationId/documents";
  const uploadParams = applicationParamsSchema.extend({ uploadId: z.string().uuid() });
  const versionParams = applicationParamsSchema.extend({ versionId: z.string().uuid() });
  const okSchema = z.object({ ok: z.literal(true) });
  app.get(
    documentsBase,
    {
      schema: {
        params: applicationParamsSchema,
        response: { 200: documentsViewSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return documentTransport.list(request.authentication.actor, bankId, applicationId);
    },
  );
  app.post(
    `${documentsBase}/uploads`,
    {
      schema: {
        params: applicationParamsSchema,
        body: beginDocumentBatchSchema,
        response: { 200: documentUploadResultSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return documentTransport.begin(
        request.authentication.actor,
        bankId,
        applicationId,
        request.body,
        request.id,
      );
    },
  );
  app.put<{
    Params: { bankId: string; applicationId: string; uploadId: string };
    Body: ByteSource;
  }>(
    `${documentsBase}/uploads/:uploadId/content`,
    { schema: { params: uploadParams, response: { 200: okSchema, ...responses } } },
    async (request) => {
      const { bankId, applicationId, uploadId } = request.params;
      assertSessionBank(request.authentication, bankId);
      if (request.headers["content-type"] !== "application/octet-stream")
        throw new DomainError("INVALID_INPUT", 400, "Send file bytes as application/octet-stream.");
      return documentTransport.put(
        request.authentication.actor,
        bankId,
        applicationId,
        uploadId,
        request.body,
        request.id,
      );
    },
  );
  app.delete(
    `${documentsBase}/uploads/:uploadId`,
    { schema: { params: uploadParams, response: { 200: okSchema, ...responses } } },
    async (request) => {
      const { bankId, applicationId, uploadId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return documentTransport.cancel(
        request.authentication.actor,
        bankId,
        applicationId,
        uploadId,
        request.id,
      );
    },
  );
  app.get(
    `${documentsBase}/versions/:versionId/content`,
    { schema: { params: versionParams } },
    async (request, reply) => {
      const { bankId, applicationId, versionId } = request.params;
      assertSessionBank(request.authentication, bankId);
      const content = await documentTransport.download(
        request.authentication.actor,
        bankId,
        applicationId,
        versionId,
      );
      return reply.headers(content.headers).send(Readable.from(webByteSource(content.body)));
    },
  );
  app.post(
    `${documentsBase}/versions/:versionId/retry-scan`,
    {
      schema: {
        params: versionParams,
        body: z.strictObject({}),
        response: { 200: okSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, versionId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return documentTransport.retry(
        request.authentication.actor,
        bankId,
        applicationId,
        versionId,
        request.id,
      );
    },
  );
  app.post(
    `${documentsBase}/versions/:versionId/retry-processing`,
    {
      schema: {
        params: versionParams,
        body: z.strictObject({}),
        response: { 200: okSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, versionId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return documentTransport.retryProcessing(
        request.authentication.actor,
        bankId,
        applicationId,
        versionId,
        request.id,
      );
    },
  );
  app.post(
    `${documentsBase}/:documentId/category`,
    {
      schema: {
        params: applicationParamsSchema.extend({ documentId: z.string().uuid() }),
        body: correctDocumentCategorySchema,
        response: { 200: okSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, documentId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return documentTransport.correctCategory(
        request.authentication.actor,
        bankId,
        applicationId,
        documentId,
        request.body,
        request.id,
      );
    },
  );
  const enrichmentBase = "/api/v1/banks/:bankId/applications/:applicationId/enrichment";
  app.get(
    enrichmentBase,
    {
      schema: {
        params: applicationParamsSchema,
        querystring: enrichmentSubjectSchema,
        response: { 200: enrichmentViewSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return enrichment().read(request.authentication.actor, bankId, applicationId, request.query);
    },
  );
  for (const [action, schema, method] of [
    ["identifier", saveIdentifierSchema, "saveIdentifier"],
    ["tax-authorization", authorizeTaxSchema, "authorizeTax"],
    ["requests", requestEnrichmentSchema, "requestRun"],
    ["confirm-fact", confirmEnrichmentFactSchema, "confirmFact"],
  ] as const) {
    app.post(
      `${enrichmentBase}/${action}`,
      {
        schema: {
          params: applicationParamsSchema,
          body: schema,
          response: { 200: enrichmentViewSchema, ...responses },
        },
      },
      async (request) => {
        const { bankId, applicationId } = request.params;
        assertSessionBank(request.authentication, bankId);
        return enrichment()[method](
          request.authentication.actor,
          bankId,
          applicationId,
          request.body,
          request.id,
        );
      },
    );
  }
  app.post(
    `${enrichmentBase}/runs/:runId/retry`,
    {
      schema: {
        params: applicationParamsSchema.extend({ runId: z.string().uuid() }),
        body: retryEnrichmentSchema,
        response: { 200: enrichmentViewSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, runId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return enrichment().retry(
        request.authentication.actor,
        bankId,
        applicationId,
        runId,
        request.body,
        request.id,
      );
    },
  );
  const tasksBase = "/api/v1/banks/:bankId/applications/:applicationId/tasks";
  const taskParams = applicationParamsSchema.extend({ taskId: z.string().uuid() });
  app.get(
    tasksBase,
    {
      schema: { params: applicationParamsSchema, response: { 200: tasksViewSchema, ...responses } },
    },
    async (request) => {
      const { bankId, applicationId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return tasks.read(request.authentication.actor, bankId, applicationId);
    },
  );
  app.get(
    `${tasksBase}/:taskId`,
    {
      schema: { params: taskParams, response: { 200: taskViewSchema, ...responses } },
    },
    async (request) => {
      const { bankId, applicationId, taskId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return tasks.detail(request.authentication.actor, bankId, applicationId, taskId);
    },
  );
  app.post(
    tasksBase,
    {
      schema: {
        params: applicationParamsSchema,
        body: createManualTaskSchema,
        response: { 200: tasksViewSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return tasks.createManual(
        request.authentication.actor,
        bankId,
        applicationId,
        request.body,
        request.id,
      );
    },
  );
  app.patch(
    `${tasksBase}/:taskId/assignment`,
    {
      schema: {
        params: taskParams,
        body: assignTaskSchema,
        response: { 200: taskViewSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, taskId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return tasks.assign(
        request.authentication.actor,
        bankId,
        applicationId,
        taskId,
        request.body,
        request.id,
      );
    },
  );
  app.patch(
    `${tasksBase}/:taskId/answer`,
    {
      schema: {
        params: taskParams,
        body: saveTaskAnswerSchema,
        response: { 200: taskViewSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, taskId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return tasks.saveAnswer(
        request.authentication.actor,
        bankId,
        applicationId,
        taskId,
        request.body,
        request.id,
      );
    },
  );
  app.post(
    `${tasksBase}/:taskId/submit`,
    {
      schema: {
        params: taskParams,
        body: taskRevisionSchema,
        response: { 200: taskViewSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, taskId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return tasks.submit(
        request.authentication.actor,
        bankId,
        applicationId,
        taskId,
        request.body,
        request.id,
      );
    },
  );
  app.post(
    `${tasksBase}/:taskId/review`,
    {
      schema: {
        params: taskParams,
        body: reviewTaskSchema,
        response: { 200: taskViewSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, taskId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return tasks.review(
        request.authentication.actor,
        bankId,
        applicationId,
        taskId,
        request.body,
        request.id,
      );
    },
  );
  app.post(
    `${tasksBase}/:taskId/waive`,
    {
      schema: {
        params: taskParams,
        body: waiveTaskSchema,
        response: { 200: taskViewSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, taskId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return tasks.waive(
        request.authentication.actor,
        bankId,
        applicationId,
        taskId,
        request.body,
        request.id,
      );
    },
  );
  const peopleBase = "/api/v1/banks/:bankId/applications/:applicationId/participants";
  const invitationParams = applicationParamsSchema.extend({ invitationId: z.string().uuid() });
  const recipientParams = bankParamsSchema.extend({ invitationId: z.string().uuid() });
  app.get(
    peopleBase,
    {
      schema: {
        params: applicationParamsSchema,
        response: { 200: participantsWorkspaceSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return participants.read(request.authentication.actor, bankId, applicationId);
    },
  );
  app.post(
    `${peopleBase}/relationships`,
    {
      schema: {
        params: applicationParamsSchema,
        body: addBusinessRelationshipSchema,
        response: { 200: participantsWorkspaceSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return participants.addRelationship(
        request.authentication.actor,
        bankId,
        applicationId,
        request.body,
        request.id,
      );
    },
  );
  app.post(
    `${peopleBase}/invitations`,
    {
      schema: {
        params: applicationParamsSchema,
        body: createInvitationSchema,
        response: { 200: participantsWorkspaceSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return participants.createInvitation(
        request.authentication.actor,
        bankId,
        applicationId,
        request.body,
        request.id,
      );
    },
  );
  app.post(
    `${peopleBase}/relationships/:relationshipId/status`,
    {
      schema: {
        params: applicationParamsSchema.extend({ relationshipId: z.string().uuid() }),
        body: setRelationshipActiveSchema,
        response: { 200: participantsWorkspaceSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, relationshipId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return participants.setRelationshipActive(
        request.authentication.actor,
        bankId,
        applicationId,
        relationshipId,
        request.body,
        request.id,
      );
    },
  );
  app.post(
    `${peopleBase}/relationships/:relationshipId/user`,
    {
      schema: {
        params: applicationParamsSchema.extend({ relationshipId: z.string().uuid() }),
        body: linkRelationshipSchema,
        response: { 200: participantsWorkspaceSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, relationshipId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return participants.linkRelationship(
        request.authentication.actor,
        bankId,
        applicationId,
        relationshipId,
        request.body,
        request.id,
      );
    },
  );
  for (const action of ["resend", "revoke"] as const) {
    app.post(
      `${peopleBase}/invitations/:invitationId/${action}`,
      {
        schema: {
          params: invitationParams,
          body: participantCommandSchema,
          response: { 200: participantsWorkspaceSchema, ...responses },
        },
      },
      async (request) => {
        const { bankId, applicationId, invitationId } = request.params;
        assertSessionBank(request.authentication, bankId);
        const command =
          action === "resend" ? participants.resendInvitation : participants.revokeInvitation;
        return command(
          request.authentication.actor,
          bankId,
          applicationId,
          invitationId,
          request.body,
          request.id,
        );
      },
    );
  }
  app.post(
    `${peopleBase}/:participantId/remove`,
    {
      schema: {
        params: applicationParamsSchema.extend({ participantId: z.string().uuid() }),
        body: participantCommandSchema,
        response: { 200: participantsWorkspaceSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, applicationId, participantId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return participants.removeParticipant(
        request.authentication.actor,
        bankId,
        applicationId,
        participantId,
        request.body,
        request.id,
      );
    },
  );
  app.get(
    "/api/v1/banks/:bankId/invitations/:invitationId",
    {
      schema: { params: recipientParams, response: { 200: invitationViewSchema, ...responses } },
    },
    async (request) => {
      const { bankId, invitationId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return participants.readInvitation(request.authentication.actor, bankId, invitationId);
    },
  );
  app.post(
    "/api/v1/banks/:bankId/invitations/:invitationId/accept",
    {
      schema: {
        params: recipientParams,
        body: z.strictObject({}),
        response: { 200: acceptInvitationResponseSchema, ...responses },
      },
    },
    async (request) => {
      const { bankId, invitationId } = request.params;
      assertSessionBank(request.authentication, bankId);
      return participants.acceptInvitation(
        request.authentication.actor,
        bankId,
        invitationId,
        request.id,
      );
    },
  );
  return app;
}
