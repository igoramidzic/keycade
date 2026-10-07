import { accessDeliveryRequests, type Database } from "@keycade/db";
import { createIdentityService } from "@keycade/domain";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { AccessEmailAdapter } from "./mailpit.js";
import { type Clock, systemClock } from "./provider.js";

/** This delivery-request row is the identity outbox. Only its ID enters the queue. */
export async function dispatchAccessDeliveries(
  db: Database,
  send: (message: { deliveryRequestId: string }) => Promise<unknown>,
  clock: Clock = systemClock,
  afterSend?: () => Promise<void>,
): Promise<number> {
  return db.transaction(async (tx) => {
    const pending = await tx
      .select({ id: accessDeliveryRequests.id })
      .from(accessDeliveryRequests)
      .where(
        and(
          isNull(accessDeliveryRequests.consumedAt),
          isNull(accessDeliveryRequests.revokedAt),
          or(
            and(
              eq(accessDeliveryRequests.status, "queued"),
              lte(accessDeliveryRequests.availableAt, clock.now()),
            ),
            and(
              eq(accessDeliveryRequests.status, "sending"),
              lte(accessDeliveryRequests.leaseUntil, clock.now()),
            ),
          ),
          or(
            isNull(accessDeliveryRequests.dispatchedAt),
            lte(accessDeliveryRequests.dispatchedAt, new Date(clock.now().getTime() - 60_000)),
          ),
        ),
      )
      .limit(25)
      .for("update", { skipLocked: true });
    for (const request of pending) {
      await send({ deliveryRequestId: request.id });
      await afterSend?.();
      await tx
        .update(accessDeliveryRequests)
        .set({ dispatchedAt: clock.now() })
        .where(eq(accessDeliveryRequests.id, request.id));
    }
    return pending.length;
  });
}

/** Hash commits before SMTP; ambiguous acceptance retries mint sibling tokens with shared use. */
export async function processAccessDelivery(
  db: Database,
  deliveryRequestId: string,
  adapter: AccessEmailAdapter,
  options: { clock?: Clock; delayMs?: number; afterSend?: () => Promise<void> } = {},
): Promise<void> {
  const clock = options.clock ?? systemClock;
  const identity = createIdentityService(db, { clock: () => clock.now() });
  const delivery = await identity.prepareDelivery(deliveryRequestId);
  if (!delivery) return;
  try {
    await clock.sleep(options.delayMs ?? 500);
    await adapter.send(delivery);
  } catch {
    await identity.failDelivery(deliveryRequestId, delivery.claimToken, "smtp_unavailable");
    return;
  }
  // Deliberately outside the SMTP catch: a simulated crash leaves the claim for lease recovery.
  await options.afterSend?.();
  await identity.completeDelivery(deliveryRequestId, delivery.claimToken);
}
