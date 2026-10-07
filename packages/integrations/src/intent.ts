import {
  applications,
  auditEvents,
  type DatabaseTransaction,
  integrationRuns,
  outboxEvents,
} from "@keycade/db";
import { and, eq } from "drizzle-orm";
import { type Clock, type DemoScenario, scenarioSchema, systemClock } from "./provider.js";

export interface DemoIntent {
  bankId: string;
  applicationId: string;
  scenario: DemoScenario;
  requestId: string;
  maxAttempts?: number;
  operationId?: string;
}
/** Called inside the same transaction as a consequential business change. Local tooling only. */
export async function enqueueDemo(
  tx: DatabaseTransaction,
  input: DemoIntent,
  clock: Clock = systemClock,
): Promise<string> {
  scenarioSchema.parse(input.scenario);
  const [application] = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.id, input.applicationId), eq(applications.bankId, input.bankId)))
    .for("update");
  if (!application || !application.synthetic)
    throw new Error("Demo operations require a synthetic application in the specified bank.");
  if (["withdrawn", "declined", "funded"].includes(application.status))
    throw new Error("Demo operation is no longer applicable.");
  const id = input.operationId ?? globalThis.crypto.randomUUID();
  await tx.insert(integrationRuns).values({
    id,
    bankId: input.bankId,
    applicationId: input.applicationId,
    inputRevision: application.revision,
    scenario: input.scenario,
    maxAttempts: input.maxAttempts ?? 3,
    requestId: input.requestId,
    availableAt: clock.now(),
  });
  await tx
    .insert(outboxEvents)
    .values({ bankId: input.bankId, applicationId: input.applicationId, runId: id });
  await tx.insert(auditEvents).values({
    bankId: input.bankId,
    applicationId: input.applicationId,
    actorType: "system",
    action: "simulation.requested",
    targetType: "integration_run",
    targetId: id,
    requestId: input.requestId,
    metadata: { simulated: true, scenario: input.scenario },
  });
  return id;
}
