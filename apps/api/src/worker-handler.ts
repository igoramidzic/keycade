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
  financialFactsViewSchema,
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
  reviewFinancialFactsSchema,
  reviewTaskSchema,
  saveApplicationSetupSchema,
  saveIdentifierSchema,
  saveSetupIdentifierSchema,
  saveTaskAnswerSchema,
  setRelationshipActiveSchema,
  staffApplicationPageSchema,
  staffApplicationSchema,
  staffNoteParamsSchema,
  staffOptionsSchema,
  staffOverviewSchema,
  staffPageQuerySchema,
  staffSessionSchema,
  staffSignInAccountsSchema,
  staffSignInQuerySchema,
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
  createFinancialFactsService,
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
  readStaffOverview,
  readStaffWorkspace,
  requireBankStaff,
  updateApplicationPurpose,
  updateStaffNote,
} from "@keycade/domain";
import { webByteSource } from "@keycade/integrations/documents";
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
import {
  createDocumentTransport,
  type DocumentTransportOptions,
  documentReservationMaxBytes,
} from "./documents.js";
import {
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
  workflowOpenApi,
} from "./workflows.js";

export interface WorkerDependencies extends IdentityTransportOptions, DocumentTransportOptions {
  db: Database;
  encryptionKey?: string;
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
  const headers: Record<string, string> = {
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
    const applications = createApplicationService(deps.db, {
      requireStaffContinuation: true,
      staffContinuationOrigin:
        deps.authDeliveryEnabled === false ? undefined : deps.portalOrigins?.borrower?.[0],
    });
    const participants = createParticipantsService(deps.db, {
      borrowerOrigin: deps.portalOrigins?.borrower?.[0] ?? "http://localhost:3001",
      deliveryEnabled: deps.authDeliveryEnabled !== false && !!deps.portalOrigins?.borrower?.[0],
    });
    const tasks = createTasksService(deps.db);
    const workflows = createWorkflowTransport(deps.db, deps);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !(request.method === "POST" && path === signatureWebhookPath) &&
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
    if (request.method === "POST" && path === signatureWebhookPath) {
      if (
        request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        signatureWebhookContentType
      )
        throw new DomainError("INVALID_INPUT", 400, "Invalid simulated provider event.");
      return json(
        await workflows.webhook(
          await readRawBody(request),
          request.headers.get("x-keycade-signature") ?? undefined,
          requestId,
        ),
      );
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
      const requestBody = (schema: z.ZodType) => ({
        required: true,
        content: { "application/json": { schema: z.toJSONSchema(schema) } },
      });
      const applicationResponses = (schema: z.ZodType) => ({
        "200": response(schema),
        ...Object.fromEntries(
          [400, 403, 404, 409, 429, 500, 503].map((code) => [code, response(errorSchema)]),
        ),
      });
      return json({
        openapi: "3.1.0",
        info: { title: "Keycade simulation API", version: "0.1.0" },
        paths: {
          ...workflowOpenApi(workflows.routes),
          "/api/v1/banks/{bankId}/applications/{applicationId}/overview": {
            get: { parameters, responses: applicationResponses(staffOverviewSchema) },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/documents": {
            get: { parameters, responses: applicationResponses(documentsViewSchema) },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/documents/uploads": {
            post: {
              parameters,
              requestBody: requestBody(beginDocumentBatchSchema),
              responses: applicationResponses(documentUploadResultSchema),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/documents/{documentId}/category": {
            post: {
              parameters: [
                ...parameters,
                {
                  name: "documentId",
                  in: "path",
                  required: true,
                  schema: { type: "string", format: "uuid" },
                },
              ],
              requestBody: requestBody(correctDocumentCategorySchema),
              responses: applicationResponses(z.object({ ok: z.literal(true) })),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/documents/versions/{versionId}/retry-processing":
            {
              post: {
                parameters: [
                  ...parameters,
                  {
                    name: "versionId",
                    in: "path",
                    required: true,
                    schema: { type: "string", format: "uuid" },
                  },
                ],
                requestBody: requestBody(z.strictObject({})),
                responses: applicationResponses(z.object({ ok: z.literal(true) })),
              },
            },
          "/api/v1/banks/{bankId}/applications/{applicationId}/enrichment": {
            get: { parameters, responses: applicationResponses(enrichmentViewSchema) },
          },
          ...Object.fromEntries(
            [
              ["identifier", saveIdentifierSchema],
              ["tax-authorization", authorizeTaxSchema],
              ["requests", requestEnrichmentSchema],
              ["confirm-fact", confirmEnrichmentFactSchema],
            ].map(([action, schema]) => [
              `/api/v1/banks/{bankId}/applications/{applicationId}/enrichment/${action}`,
              {
                post: {
                  parameters,
                  requestBody: requestBody(schema as z.ZodType),
                  responses: applicationResponses(enrichmentViewSchema),
                },
              },
            ]),
          ),
          "/api/v1/banks/{bankId}/applications/{applicationId}/enrichment/runs/{runId}/retry": {
            post: {
              parameters: [
                ...parameters,
                {
                  name: "runId",
                  in: "path",
                  required: true,
                  schema: { type: "string", format: "uuid" },
                },
              ],
              requestBody: requestBody(retryEnrichmentSchema),
              responses: applicationResponses(enrichmentViewSchema),
            },
          },
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
          "/api/v1/public/banks/{bankSlug}/intake": {
            get: {
              parameters: [
                {
                  name: "bankSlug",
                  in: "path",
                  required: true,
                  schema: z.toJSONSchema(publicIntakeParamsSchema.shape.bankSlug),
                },
              ],
              responses: {
                "200": response(publicIntakeSchema),
                ...Object.fromEntries(
                  [400, 404, 429, 500].map((code) => [code, response(errorSchema)]),
                ),
              },
            },
          },
          "/api/v1/auth/staff-accounts": {
            get: {
              parameters: [
                {
                  name: "bankSlug",
                  in: "query",
                  required: true,
                  schema: z.toJSONSchema(staffSignInQuerySchema.shape.bankSlug),
                },
              ],
              responses: {
                "200": response(staffSignInAccountsSchema),
                "400": response(errorSchema),
                "429": response(errorSchema),
                "503": response(errorSchema),
              },
            },
          },
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
          "/api/v1/applications/start": {
            post: {
              requestBody: requestBody(publicStartApplicationSchema),
              responses: {
                "202": response(requestAccessLinkResponseSchema),
                ...Object.fromEntries(
                  [400, 403, 409, 429, 500, 503].map((code) => [code, response(errorSchema)]),
                ),
              },
            },
          },
          "/api/v1/banks/{bankId}/applications": {
            get: {
              parameters: [
                parameters[0],
                { name: "after", in: "query", schema: { type: "string", format: "uuid" } },
                {
                  name: "limit",
                  in: "query",
                  schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
                },
              ],
              responses: applicationResponses(applicationPageSchema),
            },
            post: {
              parameters: [parameters[0]],
              requestBody: requestBody(createDraftSchema),
              responses: applicationResponses(applicationSetupSchema),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/setup": {
            get: { parameters, responses: applicationResponses(applicationSetupSchema) },
            patch: {
              parameters,
              requestBody: requestBody(saveApplicationSetupSchema),
              responses: applicationResponses(applicationSetupSchema),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/setup/identifier": {
            patch: {
              parameters,
              requestBody: requestBody(saveSetupIdentifierSchema),
              responses: applicationResponses(applicationSetupSchema),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/setup/finish": {
            post: {
              parameters,
              requestBody: requestBody(finishApplicationSetupSchema),
              responses: applicationResponses(applicationSetupSchema),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/claim": {
            post: {
              parameters,
              requestBody: requestBody(claimApplicationSchema),
              responses: applicationResponses(applicationSetupSchema),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/destination": {
            get: { parameters, responses: applicationResponses(applicationSelectionSchema) },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/portal": {
            get: { parameters, responses: applicationResponses(applicationPortalSchema) },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}": {
            get: { parameters, responses: { "200": response(publicApplicationSchema) } },
          },
          "/api/v1/banks/{bankId}/staff/applications/{applicationId}": {
            get: { parameters, responses: { "200": response(staffApplicationSchema) } },
          },
          "/api/v1/banks/{bankId}/staff/options": {
            get: {
              parameters: [parameters[0]],
              responses: applicationResponses(staffOptionsSchema),
            },
          },
          "/api/v1/banks/{bankId}/staff/applications": {
            get: {
              parameters: [
                parameters[0],
                ...Object.entries(staffPageQuerySchema.shape).map(([name, schema]) => ({
                  name,
                  in: "query",
                  schema: z.toJSONSchema(schema),
                })),
              ],
              responses: applicationResponses(staffApplicationPageSchema),
            },
            post: {
              parameters: [parameters[0]],
              requestBody: requestBody(createDraftSchema),
              responses: applicationResponses(applicationSetupSchema),
            },
          },
          "/api/v1/banks/{bankId}/staff/applications/{applicationId}/workspace": {
            get: { parameters, responses: applicationResponses(staffWorkspaceSchema) },
          },
          "/api/v1/banks/{bankId}/staff/applications/{applicationId}/setup": {
            get: { parameters, responses: applicationResponses(applicationSetupSchema) },
            patch: {
              parameters,
              requestBody: requestBody(saveApplicationSetupSchema),
              responses: applicationResponses(applicationSetupSchema),
            },
          },
          "/api/v1/banks/{bankId}/staff/applications/{applicationId}/assignment": {
            patch: {
              parameters,
              requestBody: requestBody(assignStaffSchema),
              responses: applicationResponses(staffWorkspaceSchema),
            },
          },
          "/api/v1/banks/{bankId}/staff/applications/{applicationId}/notes": {
            post: {
              parameters,
              requestBody: requestBody(addStaffNoteSchema),
              responses: applicationResponses(staffWorkspaceSchema),
            },
          },
          "/api/v1/banks/{bankId}/staff/applications/{applicationId}/notes/{noteId}": {
            patch: {
              parameters: [
                ...parameters,
                {
                  name: "noteId",
                  in: "path",
                  required: true,
                  schema: { type: "string", format: "uuid" },
                },
              ],
              requestBody: requestBody(updateStaffNoteSchema),
              responses: applicationResponses(staffWorkspaceSchema),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/participants": {
            get: {
              parameters: parameters,
              responses: applicationResponses(participantsWorkspaceSchema),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/participants/relationships": {
            post: {
              parameters: parameters,
              responses: applicationResponses(participantsWorkspaceSchema),
              requestBody: requestBody(addBusinessRelationshipSchema),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/participants/invitations": {
            post: {
              parameters: parameters,
              responses: applicationResponses(participantsWorkspaceSchema),
              requestBody: requestBody(createInvitationSchema),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/participants/invitations/{invitationId}/resend":
            {
              post: {
                parameters: [
                  ...parameters,
                  {
                    name: "invitationId",
                    in: "path",
                    required: true,
                    schema: { type: "string", format: "uuid" },
                  },
                ],
                responses: applicationResponses(participantsWorkspaceSchema),
                requestBody: requestBody(participantCommandSchema),
              },
            },
          "/api/v1/banks/{bankId}/applications/{applicationId}/participants/invitations/{invitationId}/revoke":
            {
              post: {
                parameters: [
                  ...parameters,
                  {
                    name: "invitationId",
                    in: "path",
                    required: true,
                    schema: { type: "string", format: "uuid" },
                  },
                ],
                responses: applicationResponses(participantsWorkspaceSchema),
                requestBody: requestBody(participantCommandSchema),
              },
            },
          "/api/v1/banks/{bankId}/applications/{applicationId}/participants/{participantId}/remove":
            {
              post: {
                parameters: [
                  ...parameters,
                  {
                    name: "participantId",
                    in: "path",
                    required: true,
                    schema: { type: "string", format: "uuid" },
                  },
                ],
                responses: applicationResponses(participantsWorkspaceSchema),
                requestBody: requestBody(participantCommandSchema),
              },
            },
          "/api/v1/banks/{bankId}/invitations/{invitationId}": {
            get: {
              parameters: [
                parameters[0],
                {
                  name: "invitationId",
                  in: "path",
                  required: true,
                  schema: { type: "string", format: "uuid" },
                },
              ],
              responses: applicationResponses(invitationViewSchema),
            },
          },
          "/api/v1/banks/{bankId}/invitations/{invitationId}/accept": {
            post: {
              parameters: [
                parameters[0],
                {
                  name: "invitationId",
                  in: "path",
                  required: true,
                  schema: { type: "string", format: "uuid" },
                },
              ],
              responses: applicationResponses(acceptInvitationResponseSchema),
              requestBody: requestBody(z.strictObject({})),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/tasks": {
            get: { parameters, responses: applicationResponses(tasksViewSchema) },
            post: {
              parameters,
              requestBody: requestBody(createManualTaskSchema),
              responses: applicationResponses(tasksViewSchema),
            },
          },
          "/api/v1/banks/{bankId}/applications/{applicationId}/tasks/{taskId}": {
            get: {
              parameters: [
                ...parameters,
                {
                  name: "taskId",
                  in: "path",
                  required: true,
                  schema: { type: "string", format: "uuid" },
                },
              ],
              responses: applicationResponses(taskViewSchema),
            },
          },
          ...Object.fromEntries(
            (
              [
                ["assignment", "patch", assignTaskSchema],
                ["answer", "patch", saveTaskAnswerSchema],
                ["submit", "post", taskRevisionSchema],
                ["review", "post", reviewTaskSchema],
                ["waive", "post", waiveTaskSchema],
              ] as const
            ).map(([action, method, schema]) => [
              `/api/v1/banks/{bankId}/applications/{applicationId}/tasks/{taskId}/${action}`,
              {
                [method]: {
                  parameters: [
                    ...parameters,
                    {
                      name: "taskId",
                      in: "path",
                      required: true,
                      schema: { type: "string", format: "uuid" },
                    },
                  ],
                  requestBody: requestBody(schema),
                  responses: applicationResponses(taskViewSchema),
                },
              },
            ]),
          ),
          ...Object.fromEntries(
            (
              [
                ["status", setRelationshipActiveSchema],
                ["user", linkRelationshipSchema],
              ] as const
            ).map(([action, schema]) => [
              `/api/v1/banks/{bankId}/applications/{applicationId}/participants/relationships/{relationshipId}/${action}`,
              {
                post: {
                  parameters: [
                    ...parameters,
                    {
                      name: "relationshipId",
                      in: "path",
                      required: true,
                      schema: { type: "string", format: "uuid" },
                    },
                  ],
                  requestBody: requestBody(schema),
                  responses: applicationResponses(participantsWorkspaceSchema),
                },
              },
            ]),
          ),
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
    const intake = /^\/api\/v1\/public\/banks\/([^/]+)\/intake$/.exec(path);
    if (get && intake) {
      const params = publicIntakeParamsSchema.parse({ bankSlug: intake[1] });
      publicIntakeQuerySchema.parse(Object.fromEntries(url.searchParams));
      return json(publicIntakeSchema.parse(await readPublicIntake(deps.db, params)));
    }
    const authentication = deps.authenticate
      ? await deps.authenticate(request)
      : await authenticateSession(
          identity,
          request.headers.get("cookie") ?? undefined,
          origin,
          deps.demoSignInEnabled,
        );
    assertExpectedSession(authentication, request.headers.get("x-keycade-session"));
    if (request.headers.has("x-keycade-session")) headers["x-keycade-session-bound"] = "1";
    if (
      !get &&
      request.method !== "OPTIONS" &&
      authentication.actor.kind === "user" &&
      !validCsrfToken(request.headers.get("x-csrf-token"), authentication.csrfToken)
    ) {
      return failure(403, "FORBIDDEN", "Invalid request verification.");
    }
    const workflow = workflows.match(path, request.method);
    if (workflow) {
      const { route, params } = workflow;
      assertSessionBank(authentication, params.bankId);
      const input = route.body
        ? route.body.parse(await readJsonBody(request))
        : route.query
          ? route.query.parse(Object.fromEntries(new URL(request.url).searchParams))
          : undefined;
      const result = route.response.parse(
        await route.handle({ actor: authentication.actor, params, input, requestId }),
      );
      if (route.download)
        return new Response(request.method === "HEAD" ? null : String(result), {
          headers: {
            ...headers,
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": 'attachment; filename="simulated-signature.txt"',
            "content-security-policy": "sandbox",
          },
        });
      return json(result);
    }
    const enrichmentMatch =
      /^\/api\/v1\/banks\/([^/]+)\/applications\/([^/]+)\/enrichment(?:\/(identifier|tax-authorization|requests|confirm-fact)|\/runs\/([^/]+)\/(retry))?$/.exec(
        path,
      );
    if (enrichmentMatch) {
      const { bankId, applicationId } = applicationParamsSchema.parse({
        bankId: enrichmentMatch[1],
        applicationId: enrichmentMatch[2],
      });
      assertSessionBank(authentication, bankId);
      if (!deps.encryptionKey)
        throw new DomainError(
          "ENRICHMENT_UNAVAILABLE",
          503,
          "Private enrichment is unavailable in this environment.",
        );
      const service = createEnrichmentService(deps.db, {
        cipher: createIdentifierCipher(deps.encryptionKey),
      });
      const actor = authentication.actor;
      if (!enrichmentMatch[3] && !enrichmentMatch[4] && get)
        return json(
          enrichmentViewSchema.parse(
            await service.read(
              actor,
              bankId,
              applicationId,
              enrichmentSubjectSchema.parse(Object.fromEntries(url.searchParams)),
            ),
          ),
        );
      if (request.method === "POST") {
        const input = await readJsonBody(request);
        if (enrichmentMatch[4])
          return json(
            enrichmentViewSchema.parse(
              await service.retry(
                actor,
                bankId,
                applicationId,
                z.string().uuid().parse(enrichmentMatch[4]),
                retryEnrichmentSchema.parse(input),
                requestId,
              ),
            ),
          );
        if (enrichmentMatch[3] === "identifier")
          return json(
            enrichmentViewSchema.parse(
              await service.saveIdentifier(
                actor,
                bankId,
                applicationId,
                saveIdentifierSchema.parse(input),
                requestId,
              ),
            ),
          );
        if (enrichmentMatch[3] === "tax-authorization")
          return json(
            enrichmentViewSchema.parse(
              await service.authorizeTax(
                actor,
                bankId,
                applicationId,
                authorizeTaxSchema.parse(input),
                requestId,
              ),
            ),
          );
        if (enrichmentMatch[3] === "requests")
          return json(
            enrichmentViewSchema.parse(
              await service.requestRun(
                actor,
                bankId,
                applicationId,
                requestEnrichmentSchema.parse(input),
                requestId,
              ),
            ),
          );
        if (enrichmentMatch[3] === "confirm-fact")
          return json(
            enrichmentViewSchema.parse(
              await service.confirmFact(
                actor,
                bankId,
                applicationId,
                confirmEnrichmentFactSchema.parse(input),
                requestId,
              ),
            ),
          );
      }
      return failure(404, "NOT_FOUND", "Resource not found.");
    }
    const overviewMatch = /^\/api\/v1\/banks\/([^/]+)\/applications\/([^/]+)\/overview$/.exec(path);
    if (overviewMatch && get) {
      const { bankId, applicationId } = applicationParamsSchema.parse({
        bankId: overviewMatch[1],
        applicationId: overviewMatch[2],
      });
      assertSessionBank(authentication, bankId);
      return json(
        staffOverviewSchema.parse(
          await readStaffOverview(deps.db, authentication.actor, bankId, applicationId),
        ),
      );
    }
    const financialFactsMatch =
      /^\/api\/v1\/banks\/([^/]+)\/applications\/([^/]+)\/financial-facts$/.exec(path);
    if (financialFactsMatch) {
      const { bankId, applicationId } = applicationParamsSchema.parse({
        bankId: financialFactsMatch[1],
        applicationId: financialFactsMatch[2],
      });
      assertSessionBank(authentication, bankId);
      const service = createFinancialFactsService(deps.db);
      if (get)
        return json(
          financialFactsViewSchema.parse(
            await service.read(authentication.actor, bankId, applicationId),
          ),
        );
      if (request.method === "POST")
        return json(
          financialFactsViewSchema.parse(
            await service.review(
              authentication.actor,
              bankId,
              applicationId,
              reviewFinancialFactsSchema.parse(await readJsonBody(request)),
              requestId,
            ),
          ),
        );
      return failure(404, "NOT_FOUND", "Resource not found.");
    }
    const documentsMatch =
      /^\/api\/v1\/banks\/([^/]+)\/applications\/([^/]+)\/documents(?:\/(uploads)(?:\/([^/]+)(\/content)?)?|\/(versions)\/([^/]+)\/(content|retry-scan|retry-processing)|\/([^/]+)\/(category|metadata))?$/.exec(
        path,
      );
    if (documentsMatch) {
      const { bankId, applicationId } = applicationParamsSchema.parse({
        bankId: documentsMatch[1],
        applicationId: documentsMatch[2],
      });
      assertSessionBank(authentication, bankId);
      const documentTransport = createDocumentTransport(deps.db, deps);
      const actor = authentication.actor;
      if (!documentsMatch[3] && !documentsMatch[6] && !documentsMatch[9] && get)
        return json(
          documentsViewSchema.parse(await documentTransport.list(actor, bankId, applicationId)),
        );
      if (documentsMatch[3] && !documentsMatch[4] && request.method === "POST")
        return json(
          await documentTransport.begin(
            actor,
            bankId,
            applicationId,
            await readJsonBody(request, documentReservationMaxBytes),
            requestId,
          ),
        );
      if (documentsMatch[4]) {
        const uploadId = z.string().uuid().parse(documentsMatch[4]);
        if (documentsMatch[5] && request.method === "PUT") {
          if (request.headers.get("content-type") !== "application/octet-stream")
            return failure(400, "INVALID_INPUT", "Send file bytes as application/octet-stream.");
          return json(
            await documentTransport.put(
              actor,
              bankId,
              applicationId,
              uploadId,
              webByteSource(request.body),
              requestId,
            ),
          );
        }
        if (!documentsMatch[5] && request.method === "DELETE")
          return json(
            await documentTransport.cancel(actor, bankId, applicationId, uploadId, requestId),
          );
      }
      if (documentsMatch[9] && request.method === "POST") {
        const documentId = z.string().uuid().parse(documentsMatch[9]);
        if (documentsMatch[10] === "metadata")
          return json(
            await documentTransport.updateMetadata(
              actor,
              bankId,
              applicationId,
              documentId,
              await readJsonBody(request),
              requestId,
            ),
          );
        return json(
          await documentTransport.correctCategory(
            actor,
            bankId,
            applicationId,
            documentId,
            await readJsonBody(request),
            requestId,
          ),
        );
      }
      if (documentsMatch[7]) {
        const versionId = z.string().uuid().parse(documentsMatch[7]);
        if (documentsMatch[8] === "content" && get) {
          const content = await documentTransport.download(actor, bankId, applicationId, versionId);
          if (request.method === "HEAD") await content.body.cancel();
          return new Response(request.method === "HEAD" ? null : content.body, {
            headers: { ...headers, ...content.headers },
          });
        }
        if (documentsMatch[8] === "retry-processing" && request.method === "POST") {
          z.strictObject({}).parse(await readJsonBody(request));
          return json(
            await documentTransport.retryProcessing(
              actor,
              bankId,
              applicationId,
              versionId,
              requestId,
            ),
          );
        }
        if (documentsMatch[8] === "retry-scan" && request.method === "POST") {
          z.strictObject({}).parse(await readJsonBody(request));
          return json(
            await documentTransport.retry(actor, bankId, applicationId, versionId, requestId),
          );
        }
      }
      return failure(404, "NOT_FOUND", "Resource not found.");
    }
    if (get && path === "/api/v1/auth/session")
      return json(
        authSessionSchema.parse(
          publicSession(authentication, deps.demoSignInEnabled, deps.demoInboxEnabled),
        ),
      );
    if (get && path === "/api/v1/auth/staff-accounts") {
      const query = staffSignInQuerySchema.parse(Object.fromEntries(url.searchParams));
      if (deps.demoSignInEnabled !== true)
        return failure(503, "DEMO_SIGN_IN_UNAVAILABLE", "Sign-in is temporarily unavailable.");
      return json(
        staffSignInAccountsSchema.parse(await identity.listDemoStaffAccounts(query.bankSlug)),
      );
    }
    if (get && path === "/api/v1/auth/staff")
      return json(staffSessionSchema.parse(await readStaffSession(deps.db, authentication)));
    if (request.method === "POST" && path === "/api/v1/auth/request-link") {
      const body = requestAccessLinkSchema.parse(await readJsonBody(request));
      if (deps.authDeliveryEnabled === false)
        return failure(
          503,
          "AUTH_DELIVERY_UNAVAILABLE",
          "Email sign-in is temporarily unavailable.",
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
          "Immediate sign-in is temporarily unavailable.",
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
    if (request.method === "POST" && path === "/api/v1/applications/start") {
      const body = publicStartApplicationSchema.parse(await readJsonBody(request));
      if (deps.authDeliveryEnabled === false)
        return failure(
          503,
          "AUTH_DELIVERY_UNAVAILABLE",
          "Email sign-in is temporarily unavailable.",
        );
      if (!originHeader || !isAllowedOrigin(originHeader, deps.portalOrigins?.borrower ?? []))
        return failure(403, "FORBIDDEN", "Request origin is not allowed for this portal.");
      const result = await applications.publicStart(body, {
        origin: originHeader,
        requestId,
        rateLimitKey: request.headers.get("cf-connecting-ip") ?? "unknown",
      });
      return json(requestAccessLinkResponseSchema.parse(result), 202);
    }
    const recipient = /^\/api\/v1\/banks\/([^/]+)\/invitations\/([^/]+)(\/accept)?$/.exec(path);
    if (recipient) {
      const { bankId, invitationId } = bankParamsSchema
        .extend({ invitationId: z.string().uuid() })
        .parse({
          bankId: recipient[1],
          invitationId: recipient[2],
        });
      assertSessionBank(authentication, bankId);
      if (get && !recipient[3])
        return json(
          invitationViewSchema.parse(
            await participants.readInvitation(authentication.actor, bankId, invitationId),
          ),
        );
      if (request.method === "POST" && recipient[3]) {
        z.strictObject({}).parse(await readJsonBody(request));
        return json(
          acceptInvitationResponseSchema.parse(
            await participants.acceptInvitation(
              authentication.actor,
              bankId,
              invitationId,
              requestId,
            ),
          ),
        );
      }
      return failure(404, "NOT_FOUND", "Resource not found.");
    }
    const taskResource =
      /^\/api\/v1\/banks\/([^/]+)\/applications\/([^/]+)\/tasks(?:\/([^/]+)(?:\/(assignment|answer|submit|review|waive))?)?$/.exec(
        path,
      );
    if (taskResource) {
      const { bankId, applicationId } = applicationParamsSchema.parse({
        bankId: taskResource[1],
        applicationId: taskResource[2],
      });
      assertSessionBank(authentication, bankId);
      const actor = authentication.actor;
      const taskId = taskResource[3] ? z.string().uuid().parse(taskResource[3]) : undefined;
      const action = taskResource[4];
      if (get && !taskId)
        return json(tasksViewSchema.parse(await tasks.read(actor, bankId, applicationId)));
      if (get && taskId && !action)
        return json(taskViewSchema.parse(await tasks.detail(actor, bankId, applicationId, taskId)));
      if (request.method === "POST" && !taskId) {
        const body = createManualTaskSchema.parse(await readJsonBody(request));
        return json(
          tasksViewSchema.parse(
            await tasks.createManual(actor, bankId, applicationId, body, requestId),
          ),
        );
      }
      if (taskId && action === "assignment" && request.method === "PATCH") {
        const body = assignTaskSchema.parse(await readJsonBody(request));
        return json(
          taskViewSchema.parse(
            await tasks.assign(actor, bankId, applicationId, taskId, body, requestId),
          ),
        );
      }
      if (taskId && action === "answer" && request.method === "PATCH") {
        const body = saveTaskAnswerSchema.parse(await readJsonBody(request));
        return json(
          taskViewSchema.parse(
            await tasks.saveAnswer(actor, bankId, applicationId, taskId, body, requestId),
          ),
        );
      }
      if (taskId && action === "submit" && request.method === "POST") {
        const body = taskRevisionSchema.parse(await readJsonBody(request));
        return json(
          taskViewSchema.parse(
            await tasks.submit(actor, bankId, applicationId, taskId, body, requestId),
          ),
        );
      }
      if (taskId && action === "review" && request.method === "POST") {
        const body = reviewTaskSchema.parse(await readJsonBody(request));
        return json(
          taskViewSchema.parse(
            await tasks.review(actor, bankId, applicationId, taskId, body, requestId),
          ),
        );
      }
      if (taskId && action === "waive" && request.method === "POST") {
        const body = waiveTaskSchema.parse(await readJsonBody(request));
        return json(
          taskViewSchema.parse(
            await tasks.waive(actor, bankId, applicationId, taskId, body, requestId),
          ),
        );
      }
      return failure(404, "NOT_FOUND", "Resource not found.");
    }
    const people =
      /^\/api\/v1\/banks\/([^/]+)\/applications\/([^/]+)\/participants(?:\/(.*))?$/.exec(path);
    if (people) {
      const { bankId, applicationId } = applicationParamsSchema.parse({
        bankId: people[1],
        applicationId: people[2],
      });
      assertSessionBank(authentication, bankId);
      const actor = authentication.actor;
      const suffix = people[3];
      if (get && !suffix)
        return json(
          participantsWorkspaceSchema.parse(await participants.read(actor, bankId, applicationId)),
        );
      if (request.method === "POST") {
        if (suffix === "relationships") {
          const body = addBusinessRelationshipSchema.parse(await readJsonBody(request));
          return json(
            participantsWorkspaceSchema.parse(
              await participants.addRelationship(actor, bankId, applicationId, body, requestId),
            ),
          );
        }
        if (suffix === "invitations") {
          const body = createInvitationSchema.parse(await readJsonBody(request));
          return json(
            participantsWorkspaceSchema.parse(
              await participants.createInvitation(actor, bankId, applicationId, body, requestId),
            ),
          );
        }
        const relationshipAction = /^relationships\/([^/]+)\/(status|user)$/.exec(suffix ?? "");
        if (relationshipAction) {
          const relationshipId = z.string().uuid().parse(relationshipAction[1]);
          const input = await readJsonBody(request);
          const result =
            relationshipAction[2] === "status"
              ? await participants.setRelationshipActive(
                  actor,
                  bankId,
                  applicationId,
                  relationshipId,
                  setRelationshipActiveSchema.parse(input),
                  requestId,
                )
              : await participants.linkRelationship(
                  actor,
                  bankId,
                  applicationId,
                  relationshipId,
                  linkRelationshipSchema.parse(input),
                  requestId,
                );
          return json(participantsWorkspaceSchema.parse(result));
        }
        const invitationAction = /^invitations\/([^/]+)\/(resend|revoke)$/.exec(suffix ?? "");
        if (invitationAction) {
          const invitationId = z.string().uuid().parse(invitationAction[1]);
          const body = participantCommandSchema.parse(await readJsonBody(request));
          const command =
            invitationAction[2] === "resend"
              ? participants.resendInvitation
              : participants.revokeInvitation;
          return json(
            participantsWorkspaceSchema.parse(
              await command(actor, bankId, applicationId, invitationId, body, requestId),
            ),
          );
        }
        const remove = /^([^/]+)\/remove$/.exec(suffix ?? "");
        if (remove) {
          const participantId = z.string().uuid().parse(remove[1]);
          const body = participantCommandSchema.parse(await readJsonBody(request));
          return json(
            participantsWorkspaceSchema.parse(
              await participants.removeParticipant(
                actor,
                bankId,
                applicationId,
                participantId,
                body,
                requestId,
              ),
            ),
          );
        }
      }
      return failure(404, "NOT_FOUND", "Resource not found.");
    }
    const staffCollection = /^\/api\/v1\/banks\/([^/]+)\/staff\/(applications|options)$/.exec(path);
    if (staffCollection) {
      const { bankId } = bankParamsSchema.parse({ bankId: staffCollection[1] });
      assertSessionBank(authentication, bankId);
      if (get && staffCollection[2] === "options")
        return json(
          staffOptionsSchema.parse(await readStaffOptions(deps.db, authentication.actor, bankId)),
        );
      if (get) {
        const query = staffPageQuerySchema.parse(Object.fromEntries(url.searchParams));
        return json(
          staffApplicationPageSchema.parse(
            await listStaffApplications(deps.db, authentication.actor, bankId, query),
          ),
        );
      }
      if (request.method === "POST" && staffCollection[2] === "applications") {
        const body = createDraftSchema.parse(await readJsonBody(request));
        await requireBankStaff(deps.db, authentication.actor, bankId);
        if (deps.authDeliveryEnabled === false || !deps.portalOrigins?.borrower?.[0])
          return failure(
            503,
            "AUTH_DELIVERY_UNAVAILABLE",
            "Application continuation email is unavailable in this environment.",
          );
        return json(
          applicationSetupSchema.parse(
            await applications.create(authentication.actor, bankId, body, requestId),
          ),
        );
      }
      return failure(404, "NOT_FOUND", "Resource not found.");
    }
    const staffResource =
      /^\/api\/v1\/banks\/([^/]+)\/staff\/applications\/([^/]+)\/(workspace|setup|assignment|notes)(?:\/([^/]+))?$/.exec(
        path,
      );
    if (staffResource) {
      const { bankId, applicationId } = applicationParamsSchema.parse({
        bankId: staffResource[1],
        applicationId: staffResource[2],
      });
      assertSessionBank(authentication, bankId);
      const actor = authentication.actor;
      const resource = staffResource[3];
      const noteId = staffResource[4];
      if (resource === "workspace" && get && !noteId)
        return json(
          staffWorkspaceSchema.parse(
            await readStaffWorkspace(deps.db, actor, bankId, applicationId),
          ),
        );
      if (resource === "setup" && !noteId && (get || request.method === "PATCH")) {
        await requireBankStaff(deps.db, actor, bankId);
        if (get)
          return json(
            applicationSetupSchema.parse(
              await applications.readSetup(actor, bankId, applicationId),
            ),
          );
        const body = saveApplicationSetupSchema.parse(await readJsonBody(request));
        return json(
          applicationSetupSchema.parse(
            await applications.saveSetup(actor, bankId, applicationId, body, requestId),
          ),
        );
      }
      if (resource === "assignment" && request.method === "PATCH" && !noteId) {
        const body = assignStaffSchema.parse(await readJsonBody(request));
        return json(
          staffWorkspaceSchema.parse(
            await assignApplicationStaff(deps.db, actor, bankId, applicationId, body, requestId),
          ),
        );
      }
      if (resource === "notes" && request.method === "POST" && !noteId) {
        const body = addStaffNoteSchema.parse(await readJsonBody(request));
        return json(
          staffWorkspaceSchema.parse(
            await addStaffNote(deps.db, actor, bankId, applicationId, body, requestId),
          ),
        );
      }
      if (resource === "notes" && request.method === "PATCH" && noteId) {
        staffNoteParamsSchema.parse({ bankId, applicationId, noteId });
        const body = updateStaffNoteSchema.parse(await readJsonBody(request));
        return json(
          staffWorkspaceSchema.parse(
            await updateStaffNote(deps.db, actor, bankId, applicationId, noteId, body, requestId),
          ),
        );
      }
      return failure(404, "NOT_FOUND", "Resource not found.");
    }
    const collection = /^\/api\/v1\/banks\/([^/]+)\/applications$/.exec(path);
    if (collection && (get || request.method === "POST")) {
      const { bankId } = bankParamsSchema.parse({ bankId: collection[1] });
      assertSessionBank(authentication, bankId);
      if (get) {
        const query = pageQuerySchema.parse(Object.fromEntries(url.searchParams));
        return json(
          applicationPageSchema.parse(await applications.list(authentication.actor, bankId, query)),
        );
      }
      const body = createDraftSchema.parse(await readJsonBody(request));
      return json(
        applicationSetupSchema.parse(
          await applications.create(authentication.actor, bankId, body, requestId),
        ),
      );
    }
    const setup =
      /^\/api\/v1\/banks\/([^/]+)\/applications\/([^/]+)\/(setup(?:\/(?:finish|identifier))?|claim|destination|portal)$/.exec(
        path,
      );
    if (setup) {
      const { bankId, applicationId } = applicationParamsSchema.parse({
        bankId: setup[1],
        applicationId: setup[2],
      });
      assertSessionBank(authentication, bankId);
      const actor = authentication.actor;
      if (setup[3] === "portal" && get)
        return json(
          applicationPortalSchema.parse(await applications.portal(actor, bankId, applicationId)),
        );
      if (setup[3] === "destination" && get)
        return json(
          applicationSelectionSchema.parse(
            await applications.destination(actor, bankId, applicationId),
          ),
        );
      if (setup[3] === "setup" && get)
        return json(
          applicationSetupSchema.parse(await applications.readSetup(actor, bankId, applicationId)),
        );
      if (setup[3] === "setup" && request.method === "PATCH") {
        const body = saveApplicationSetupSchema.parse(await readJsonBody(request));
        return json(
          applicationSetupSchema.parse(
            await applications.saveSetup(actor, bankId, applicationId, body, requestId),
          ),
        );
      }
      if (setup[3] === "setup/identifier" && request.method === "PATCH") {
        const body = saveSetupIdentifierSchema.parse(await readJsonBody(request));
        if (!deps.encryptionKey)
          throw new DomainError(
            "ENRICHMENT_UNAVAILABLE",
            503,
            "Private enrichment is unavailable in this environment.",
          );
        await createEnrichmentService(deps.db, {
          cipher: createIdentifierCipher(deps.encryptionKey),
        }).saveSetupIdentifier(actor, bankId, applicationId, body, requestId);
        return json(
          applicationSetupSchema.parse(await applications.readSetup(actor, bankId, applicationId)),
        );
      }
      if (setup[3] === "setup/finish" && request.method === "POST") {
        const body = finishApplicationSetupSchema.parse(await readJsonBody(request));
        return json(
          applicationSetupSchema.parse(
            await applications.finishSetup(actor, bankId, applicationId, body, requestId),
          ),
        );
      }
      if (setup[3] === "claim" && request.method === "POST") {
        claimApplicationSchema.parse(await readJsonBody(request));
        return json(
          applicationSetupSchema.parse(
            await applications.claim(actor, bankId, applicationId, requestId),
          ),
        );
      }
      return failure(404, "NOT_FOUND", "Resource not found.");
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
    assertSessionBank(authentication, bankId);
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
    if (isServiceUnavailable(error))
      return failure(503, "SERVICE_UNAVAILABLE", serviceUnavailableMessage);
    // Database/provider errors can contain confidential values; never log raw exceptions.
    console.warn("Worker request failed.");
    return failure(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}

async function readJsonBody(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  try {
    return JSON.parse(await readRawBody(request, maxBytes));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  }
}

async function readRawBody(request: Request, maxBytes = 64 * 1024): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new DomainError("INVALID_INPUT", 413, "Invalid request.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
