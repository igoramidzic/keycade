import { randomUUID } from "node:crypto";
import { accessDeliveryRequests } from "@keycade/db";
import { seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { createIdentityService } from "@keycade/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { dispatchAccessDeliveries, processAccessDelivery } from "./access-delivery.js";
import type { AccessEmail } from "./mailpit.js";
import type { Clock } from "./provider.js";
import { accessQueue, createQueueClient, initializeQueue } from "./queue.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let boss: ReturnType<typeof createQueueClient>;
let time = new Date("2026-10-06T12:00:00Z").getTime();
const clock: Clock = { now: () => new Date(time), sleep: async () => {} };
const origin = "http://127.0.0.1:3001";
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
  await initializeQueue(database.connectionString);
  boss = createQueueClient(database.connectionString);
  await boss.start();
});
afterAll(async () => {
  await boss?.stop();
  await database?.cleanup();
});
async function request() {
  const requestId = randomUUID();
  const identity = createIdentityService(database.db, { clock: clock.now });
  await identity.requestAccessLink({
    email: `${requestId}@example.test`,
    bankSlug: "bank-a",
    portal: "borrower",
    returnPath: "/",
    origin,
    requestId,
    rateLimitKey: requestId,
  });
  const [row] = await database.db
    .select()
    .from(accessDeliveryRequests)
    .where(eq(accessDeliveryRequests.requestId, requestId));
  if (!row) throw new Error("Synthetic delivery request missing.");
  return { id: row.id, identity };
}
const send = async (message: { deliveryRequestId: string }) => boss.send(accessQueue, message);
const tokenOf = (mail: AccessEmail) =>
  new URLSearchParams(new URL(mail.confirmUrl).hash.slice(1)).get("token") ?? "";

it("queues only delivery IDs, survives send-before-mark, and deduplicates concurrent jobs", async () => {
  const { id } = await request();
  await expect(
    dispatchAccessDeliveries(database.db, send, clock, async () => {
      throw new Error("Synthetic crash");
    }),
  ).rejects.toThrow("Synthetic crash");
  await dispatchAccessDeliveries(database.db, send, clock);
  const jobs = await boss.fetch<{ deliveryRequestId: string }>(accessQueue, { batchSize: 20 });
  expect(jobs.filter((job) => job.data.deliveryRequestId === id)).toHaveLength(2);
  expect(jobs.every((job) => Object.keys(job.data).join() === "deliveryRequestId")).toBe(true);
  let deliveries = 0;
  await Promise.all(
    jobs.map((job) =>
      processAccessDelivery(
        database.db,
        job.data.deliveryRequestId,
        {
          send: async () => {
            deliveries++;
          },
        },
        { clock },
      ),
    ),
  );
  await boss.complete(
    accessQueue,
    jobs.map((job) => job.id),
  );
  expect(deliveries).toBe(1);
});

it("retries local SMTP failure and persists only fixed safe error metadata", async () => {
  const { id } = await request();
  await processAccessDelivery(
    database.db,
    id,
    {
      send: async (mail) => {
        throw new Error(mail.confirmUrl);
      },
    },
    { clock },
  );
  const [failed] = await database.db
    .select()
    .from(accessDeliveryRequests)
    .where(eq(accessDeliveryRequests.id, id));
  expect(failed?.status).toBe("queued");
  expect(failed?.lastErrorCode).toBe("LOCAL_EMAIL_DELIVERY_FAILED");
  expect(failed?.dispatchedAt).toBeNull();
  time += 1001;
  let deliveries = 0;
  await processAccessDelivery(
    database.db,
    id,
    {
      send: async () => {
        deliveries++;
      },
    },
    { clock },
  );
  expect(deliveries).toBe(1);
  const [done] = await database.db
    .select()
    .from(accessDeliveryRequests)
    .where(eq(accessDeliveryRequests.id, id));
  expect(done?.status).toBe("delivered");
});

it("recovers after SMTP acceptance and atomically invalidates retry-issued sibling links", async () => {
  const { id, identity } = await request();
  const delivered: AccessEmail[] = [];
  const adapter = {
    send: async (mail: AccessEmail) => {
      delivered.push(mail);
    },
  };
  await expect(
    processAccessDelivery(database.db, id, adapter, {
      clock,
      afterSend: async () => {
        throw new Error("Synthetic accepted crash");
      },
    }),
  ).rejects.toThrow("Synthetic accepted crash");
  time += 60_001;
  await dispatchAccessDeliveries(database.db, send, clock);
  const jobs = await boss.fetch<{ deliveryRequestId: string }>(accessQueue, { batchSize: 20 });
  for (const job of jobs)
    await processAccessDelivery(database.db, job.data.deliveryRequestId, adapter, { clock });
  await boss.complete(
    accessQueue,
    jobs.map((job) => job.id),
  );
  expect(delivered.length).toBe(2);
  const first = delivered[0];
  const second = delivered[1];
  if (!first || !second) throw new Error("Synthetic deliveries missing.");
  const results = await Promise.allSettled(
    [first, second].map((mail) =>
      identity.consumeAccessLink({
        token: tokenOf(mail),
        origin,
        requestId: randomUUID(),
        rateLimitKey: id,
      }),
    ),
  );
  expect(results.filter((result) => result.status === "fulfilled").length).toBe(1);
  await processAccessDelivery(database.db, id, adapter, { clock });
  expect(delivered.length).toBe(2);
});

it("recovers a queue fetch crash before the delivery claim", async () => {
  const { id } = await request();
  await dispatchAccessDeliveries(database.db, send, clock);
  const lost = await boss.fetch(accessQueue, { batchSize: 20 });
  expect(lost.length).toBe(1);
  time += 60_001;
  await dispatchAccessDeliveries(database.db, send, clock);
  const recovered = await boss.fetch<{ deliveryRequestId: string }>(accessQueue, { batchSize: 20 });
  expect(recovered.some((job) => job.data.deliveryRequestId === id)).toBe(true);
  let sent = false;
  for (const job of recovered)
    await processAccessDelivery(
      database.db,
      job.data.deliveryRequestId,
      {
        send: async () => {
          sent = true;
        },
      },
      { clock },
    );
  expect(sent).toBe(true);
  await boss.complete(
    accessQueue,
    [...lost, ...recovered].map((job) => job.id),
  );
});
