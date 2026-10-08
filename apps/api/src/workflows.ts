import {
  activityQuerySchema,
  activityViewSchema,
  applicationParamsSchema,
  approveApplicationSchema,
  authorizeTaskTaxSchema,
  bankParamsSchema,
  captureTaskIdentifierSchema,
  checksViewSchema,
  closingViewSchema,
  createSignatureEnvelopeSchema,
  declineApplicationSchema,
  demoInboxMessageSchema,
  demoInboxViewSchema,
  errorSchema,
  fundedAccountsViewSchema,
  notificationPreferenceSchema,
  notificationsViewSchema,
  operationCommandSchema,
  operationsViewSchema,
  readinessViewSchema,
  recordFundingSchema,
  refreshFootprintSchema,
  requestInformationSchema,
  resolveCheckSchema,
  retryCheckSchema,
  reviewViewSchema,
  signatureActionSchema,
  signatureEventSchema,
  signaturesViewSchema,
  startClosingSchema,
  startReviewSchema,
  submitApplicationSchema,
  tasksViewSchema,
  withdrawApplicationSchema,
} from "@keycade/contracts";
import { type Database, signatureEnvelopes } from "@keycade/db";
import {
  type Actor,
  applyVerifiedSignatureEvent,
  createActivityService,
  createChecksService,
  createClosingService,
  createDemoInboxCipher,
  createDemoInboxService,
  createIdentifierCipher,
  createNotificationsService,
  createOperationsService,
  createReadinessService,
  createReviewService,
  createSignaturesService,
  DomainError,
} from "@keycade/domain";
import { createSignatureWebhookAuthenticator } from "@keycade/integrations/signatures-provider";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

type Params = { bankId: string; applicationId?: string; resourceId?: string };
type Context = { actor: Actor; params: Params; input: unknown; requestId: string };
type Route = {
  method: "GET" | "POST";
  path: string;
  params: z.ZodType<Params>;
  body?: z.ZodType;
  query?: z.ZodObject;
  response: z.ZodType;
  download?: boolean;
  handle(context: Context): Promise<unknown>;
};
const base = "/api/v1/banks/:bankId/applications/:applicationId";
const bankBase = "/api/v1/banks/:bankId";
const resourceParams = applicationParamsSchema.extend({ resourceId: z.uuid() });
const empty = z.strictObject({});
const scope = (p: Params) => applicationParamsSchema.parse(p);
const resource = (p: Params) => z.uuid().parse(p.resourceId);
export const signatureWebhookPath = "/api/v1/simulated/signatures/events";
export const signatureWebhookContentType = "application/vnd.keycade.signature+json";

/** Shared route contracts keep native Workers and Fastify behavior aligned. */
export function createWorkflowTransport(
  db: Database,
  options: { encryptionKey?: string; demoInboxEnabled?: boolean },
) {
  const checks = () => {
    if (!options.encryptionKey)
      throw new DomainError(
        "ENRICHMENT_UNAVAILABLE",
        503,
        "Synthetic check storage is unavailable.",
      );
    return createChecksService(db, { cipher: createIdentifierCipher(options.encryptionKey) });
  };
  const readiness = createReadinessService(db);
  const signatures = createSignaturesService(db);
  const notifications = createNotificationsService(db);
  const review = createReviewService(db);
  const closing = createClosingService(db);
  const activity = createActivityService(db);
  const operations = () => {
    if (!options.encryptionKey)
      throw new DomainError("ENRICHMENT_UNAVAILABLE", 503, "Synthetic operations are unavailable.");
    return createOperationsService(db, { cipher: createIdentifierCipher(options.encryptionKey) });
  };
  const inbox = () => {
    if (!options.demoInboxEnabled || !options.encryptionKey)
      throw new DomainError("NOT_FOUND", 404, "Resource not found.");
    return createDemoInboxService(db, { cipher: createDemoInboxCipher(options.encryptionKey) });
  };
  const routes: Route[] = [
    {
      method: "GET",
      path: `${bankBase}/accounts`,
      params: bankParamsSchema,
      response: fundedAccountsViewSchema,
      handle: ({ actor, params: p }) => closing.listAccounts(actor, p.bankId),
    },
    {
      method: "GET",
      path: `${base}/closing`,
      params: applicationParamsSchema,
      response: closingViewSchema,
      handle: ({ actor, params: p }) => closing.read(actor, p.bankId, scope(p).applicationId),
    },
    {
      method: "POST",
      path: `${base}/closing/start`,
      params: applicationParamsSchema,
      body: startClosingSchema,
      response: closingViewSchema,
      handle: ({ actor, params: p, input, requestId }) =>
        closing.startClosing(actor, p.bankId, scope(p).applicationId, input, requestId),
    },
    {
      method: "POST",
      path: `${base}/closing/fund`,
      params: applicationParamsSchema,
      body: recordFundingSchema,
      response: closingViewSchema,
      handle: ({ actor, params: p, input, requestId }) =>
        closing.recordFunding(actor, p.bankId, scope(p).applicationId, input, requestId),
    },
    {
      method: "GET",
      path: `${base}/activity`,
      params: applicationParamsSchema,
      query: activityQuerySchema,
      response: activityViewSchema,
      handle: ({ actor, params: p, input }) =>
        activity.list(actor, p.bankId, scope(p).applicationId, input),
    },
    {
      method: "GET",
      path: `${base}/operations`,
      params: applicationParamsSchema,
      response: operationsViewSchema,
      handle: ({ actor, params: p }) => operations().read(actor, p.bankId, scope(p).applicationId),
    },
    {
      method: "POST",
      path: `${base}/operations/actions`,
      params: applicationParamsSchema,
      body: operationCommandSchema,
      response: operationsViewSchema,
      handle: ({ actor, params: p, input, requestId }) =>
        operations().act(actor, p.bankId, scope(p).applicationId, input, requestId),
    },
    {
      method: "GET",
      path: `${bankBase}/demo-inbox`,
      params: bankParamsSchema,
      response: demoInboxViewSchema,
      handle: ({ actor, params: p }) => inbox().list(actor, p.bankId),
    },
    {
      method: "GET",
      path: `${bankBase}/demo-inbox/:resourceId`,
      params: bankParamsSchema.extend({ resourceId: z.uuid() }),
      response: demoInboxMessageSchema,
      handle: ({ actor, params: p }) => inbox().open(actor, p.bankId, resource(p)),
    },
    {
      method: "GET",
      path: `${base}/review`,
      params: applicationParamsSchema,
      response: reviewViewSchema,
      handle: ({ actor, params: p }) => review.read(actor, p.bankId, scope(p).applicationId),
    },
    ...(
      [
        ["submit", "submit", submitApplicationSchema],
        ["start-review", "startReview", startReviewSchema],
        ["request-information", "requestInformation", requestInformationSchema],
        ["approve", "approve", approveApplicationSchema],
        ["decline", "decline", declineApplicationSchema],
        ["withdraw", "withdraw", withdrawApplicationSchema],
      ] as const
    ).map(
      ([path, method, body]): Route => ({
        method: "POST",
        path: `${base}/review/${path}`,
        params: applicationParamsSchema,
        body,
        response: reviewViewSchema,
        handle: ({ actor, params: p, input, requestId }) =>
          review[method](actor, p.bankId, scope(p).applicationId, input, requestId),
      }),
    ),
    {
      method: "GET",
      path: `${base}/checks`,
      params: applicationParamsSchema,
      response: checksViewSchema,
      handle: ({ actor, params: p }) => checks().read(actor, p.bankId, scope(p).applicationId),
    },
    {
      method: "GET",
      path: `${base}/readiness`,
      params: applicationParamsSchema,
      response: readinessViewSchema,
      handle: ({ actor, params: p }) => readiness.read(actor, p.bankId, scope(p).applicationId),
    },
    {
      method: "POST",
      path: `${base}/tasks/:resourceId/identifier`,
      params: resourceParams,
      body: captureTaskIdentifierSchema,
      response: tasksViewSchema,
      handle: ({ actor, params: p, input, requestId }) =>
        checks().captureIdentifier(
          actor,
          p.bankId,
          scope(p).applicationId,
          resource(p),
          captureTaskIdentifierSchema.parse(input),
          requestId,
        ),
    },
    {
      method: "POST",
      path: `${base}/tasks/:resourceId/tax-authorization`,
      params: resourceParams,
      body: authorizeTaskTaxSchema,
      response: tasksViewSchema,
      handle: ({ actor, params: p, input, requestId }) =>
        checks().authorizeTax(
          actor,
          p.bankId,
          scope(p).applicationId,
          resource(p),
          authorizeTaskTaxSchema.parse(input),
          requestId,
        ),
    },
    {
      method: "POST",
      path: `${base}/checks/:resourceId/refresh`,
      params: resourceParams,
      body: refreshFootprintSchema,
      response: checksViewSchema,
      handle: ({ actor, params: p, input, requestId }) =>
        checks().refresh(
          actor,
          p.bankId,
          scope(p).applicationId,
          resource(p),
          refreshFootprintSchema.parse(input),
          requestId,
        ),
    },
    {
      method: "POST",
      path: `${base}/checks/:resourceId/retry`,
      params: resourceParams,
      body: retryCheckSchema,
      response: checksViewSchema,
      handle: ({ actor, params: p, input, requestId }) =>
        checks().retry(
          actor,
          p.bankId,
          scope(p).applicationId,
          resource(p),
          retryCheckSchema.parse(input),
          requestId,
        ),
    },
    {
      method: "POST",
      path: `${base}/checks/:resourceId/resolve`,
      params: resourceParams,
      body: resolveCheckSchema,
      response: checksViewSchema,
      handle: ({ actor, params: p, input, requestId }) =>
        checks().resolve(
          actor,
          p.bankId,
          scope(p).applicationId,
          resource(p),
          resolveCheckSchema.parse(input),
          requestId,
        ),
    },
    {
      method: "GET",
      path: `${base}/signatures`,
      params: applicationParamsSchema,
      response: signaturesViewSchema,
      handle: ({ actor, params: p }) => signatures.list(actor, p.bankId, scope(p).applicationId),
    },
    {
      method: "POST",
      path: `${base}/signatures`,
      params: applicationParamsSchema,
      body: createSignatureEnvelopeSchema,
      response: signaturesViewSchema,
      handle: ({ actor, params: p, input, requestId }) =>
        signatures.create(actor, p.bankId, scope(p).applicationId, input, requestId),
    },
    ...(["send", "retry-send", "void"] as const).map(
      (action): Route => ({
        method: "POST",
        path: `${base}/signatures/:resourceId/${action}`,
        params: resourceParams,
        body: empty,
        response: signaturesViewSchema,
        handle: ({ actor, params: p, requestId }) =>
          signatures[action === "retry-send" ? "retrySend" : action](
            actor,
            p.bankId,
            scope(p).applicationId,
            resource(p),
            requestId,
          ),
      }),
    ),
    {
      method: "POST",
      path: `${base}/signatures/:resourceId/act`,
      params: resourceParams,
      body: signatureActionSchema,
      response: signaturesViewSchema,
      handle: ({ actor, params: p, input, requestId }) =>
        signatures.act(actor, p.bankId, scope(p).applicationId, resource(p), input, requestId),
    },
    {
      method: "GET",
      path: `${base}/signatures/:resourceId/artifact`,
      params: resourceParams,
      response: z.string(),
      download: true,
      handle: async ({ actor, params: p }) =>
        (await signatures.artifact(actor, p.bankId, scope(p).applicationId, resource(p))).body,
    },
    {
      method: "GET",
      path: `${bankBase}/signatures/:resourceId`,
      params: bankParamsSchema.extend({ resourceId: z.uuid() }),
      response: z.object({ applicationId: z.uuid(), signatures: signaturesViewSchema }),
      handle: async ({ actor, params: p }) => {
        const [envelope] = await db
          .select()
          .from(signatureEnvelopes)
          .where(
            and(eq(signatureEnvelopes.bankId, p.bankId), eq(signatureEnvelopes.id, resource(p))),
          );
        if (!envelope) throw new DomainError("NOT_FOUND", 404, "Resource not found.");
        const view = await signatures.list(actor, p.bankId, envelope.applicationId);
        if (!view.envelopes.some((entry) => entry.id === envelope.id))
          throw new DomainError("NOT_FOUND", 404, "Resource not found.");
        return {
          applicationId: envelope.applicationId,
          signatures: {
            ...view,
            envelopes: view.envelopes.filter((entry) => entry.id === envelope.id),
          },
        };
      },
    },
    {
      method: "GET",
      path: `${bankBase}/notification-preferences`,
      params: bankParamsSchema,
      response: notificationPreferenceSchema,
      handle: ({ actor, params: p }) => notifications.preferences(actor, p.bankId),
    },
    {
      method: "POST",
      path: `${bankBase}/notification-preferences`,
      params: bankParamsSchema,
      body: notificationPreferenceSchema,
      response: notificationPreferenceSchema,
      handle: ({ actor, params: p, input }) => notifications.setPreferences(actor, p.bankId, input),
    },
    {
      method: "GET",
      path: `${base}/notifications`,
      params: applicationParamsSchema,
      response: notificationsViewSchema,
      handle: ({ actor, params: p }) => notifications.list(actor, p.bankId, scope(p).applicationId),
    },
    {
      method: "POST",
      path: `${base}/notifications/:resourceId/retry`,
      params: resourceParams,
      body: empty,
      response: notificationsViewSchema,
      handle: ({ actor, params: p, requestId }) =>
        notifications.retry(actor, p.bankId, scope(p).applicationId, resource(p), requestId),
    },
  ];
  function match(path: string, method: string) {
    for (const route of routes) {
      if (route.method !== (method === "HEAD" ? "GET" : method)) continue;
      const names = [...route.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => m[1] as string);
      const found = new RegExp(`^${route.path.replace(/:[a-zA-Z]+/g, "([^/]+)")}$`).exec(path);
      if (found)
        return {
          route,
          params: route.params.parse(
            Object.fromEntries(names.map((name, i) => [name, found[i + 1]])),
          ),
        };
    }
    return null;
  }
  async function webhook(rawBody: string, signature: string | undefined, requestId: string) {
    if (
      !options.encryptionKey ||
      !createSignatureWebhookAuthenticator(options.encryptionKey).verify(rawBody, signature ?? "")
    )
      throw new DomainError("FORBIDDEN", 403, "Invalid simulated provider authentication.");
    let input: unknown;
    try {
      input = JSON.parse(rawBody);
    } catch {
      throw new DomainError("INVALID_INPUT", 400, "Invalid simulated provider event.");
    }
    const event = signatureEventSchema.safeParse(input);
    if (!event.success)
      throw new DomainError("INVALID_INPUT", 400, "Invalid simulated provider event.");
    return applyVerifiedSignatureEvent(db, event.data, { requestId });
  }
  return { routes, match, webhook };
}

export function workflowOpenApi(routes: Route[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const path = route.path.replace(/:([a-zA-Z]+)/g, "{$1}");
    const parameters = [...route.path.matchAll(/:([a-zA-Z]+)/g)].map((match) => ({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    }));
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = {
      parameters: [
        ...parameters,
        ...Object.entries(route.query?.shape ?? {}).map(([name, schema]) => ({
          name,
          in: "query",
          required: false,
          schema: z.toJSONSchema(schema as z.ZodType, { io: "input" }),
        })),
      ],
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: z.toJSONSchema(route.body) } },
            },
          }
        : {}),
      responses: {
        ...Object.fromEntries(
          [400, 403, 404, 409, 429, 500, 503].map((status) => [
            status,
            {
              description: "Request failed",
              content: { "application/json": { schema: z.toJSONSchema(errorSchema) } },
            },
          ]),
        ),
        "200": {
          description: "Success",
          content: {
            [route.download ? "text/plain" : "application/json"]: {
              schema: z.toJSONSchema(route.response),
            },
          },
        },
      },
    };
  }
  paths[signatureWebhookPath] = {
    post: {
      parameters: [
        { name: "x-keycade-signature", in: "header", required: true, schema: { type: "string" } },
      ],
      requestBody: {
        required: true,
        content: {
          [signatureWebhookContentType]: { schema: z.toJSONSchema(signatureEventSchema) },
        },
      },
      responses: { "200": { description: "Authenticated simulation event accepted" } },
    },
  };
  return paths;
}
