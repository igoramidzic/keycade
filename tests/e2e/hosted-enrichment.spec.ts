import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, test } from "@playwright/test";
import {
  type ApplicationSetup,
  type EnrichmentView,
  enrichmentViewSchema,
} from "../../packages/contracts/src/index";
import { workflowApi } from "./closing-helpers";
import { paceHostedRequests } from "./hosted-helpers";

const env = readEnvironment();
const borrower = env.KEYCADE_E2E_BORROWER_ORIGIN ?? "";
test.skip(env.KEYCADE_E2E_HOSTED !== "true", "Explicit hosted acceptance is required.");
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 25000 });
test.setTimeout(240000);

test("hosted synthetic identifiers drive authorized business and tax simulations without adopting facts", async ({
  page,
  context,
}, testInfo) => {
  await paceHostedRequests(context);
  const nonce = randomUUID().slice(0, 8);
  await page.goto(`${borrower}/?bank=bank-a`);
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`hosted-enrichment-${nonce}@example.test`);
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your applications", exact: true })).toBeVisible();
  // Park the dashboard while protected browser requests prepare only this new synthetic record.
  await page.goto(`${borrower}/api/ready`);
  let app = await workflowApi<ApplicationSetup>(page, "POST", "/applications", {
    idempotencyKey: randomUUID(),
  });
  testInfo.annotations.push({ type: "synthetic_application", description: app.id });
  for (const step of [
    {
      step: "business_name",
      currentStep: "amount",
      answers: { businessName: `Synthetic Enrichment Workshop ${nonce}` },
    },
    { step: "amount", currentStep: "purpose", answers: { requestedAmount: "10000.00" } },
    {
      step: "purpose",
      currentStep: "industry",
      answers: { purpose: "Synthetic hosted business and tax demonstration" },
    },
    { step: "industry", currentStep: "review", answers: {}, skip: true },
  ])
    app = await workflowApi<ApplicationSetup>(page, "PATCH", `/applications/${app.id}/setup`, {
      expectedRevision: app.revision,
      ...step,
    });
  app = await workflowApi<ApplicationSetup>(page, "POST", `/applications/${app.id}/setup/finish`, {
    expectedRevision: app.revision,
    idempotencyKey: randomUUID(),
  });
  expect(app.synthetic).toBe(true);
  expect(app.setupStatus).toBe("completed");
  const base = `/applications/${app.id}/enrichment`;
  async function read() {
    return enrichmentViewSchema.parse(await workflowApi<EnrichmentView>(page, "GET", base));
  }
  let view = await read();
  expect(view.identifier.present).toBe(false);
  view = enrichmentViewSchema.parse(
    await workflowApi(page, "POST", `${base}/requests`, {
      kind: "tax",
      expectedRevision: view.revision,
    }),
  );
  expect(view.runs.find((run) => !run.stale && run.kind === "tax")).toMatchObject({
    status: "waiting_for_input",
    missingPrerequisites: ["identifier", "tax_authorization"],
  });
  view = enrichmentViewSchema.parse(
    await workflowApi(page, "POST", `${base}/identifier`, {
      expectedRevision: view.revision,
      value: "000000001",
    }),
  );
  expect(view.identifier.masked).toBe("**-***0001");
  expect(JSON.stringify(view).includes('"000000001"')).toBe(false);
  expect(view.taxAuthorization.authorized).toBe(false);
  view = enrichmentViewSchema.parse(
    await workflowApi(page, "POST", `${base}/tax-authorization`, {
      expectedRevision: view.revision,
      authorized: true,
      noticeVersion: "demo-tax-v1",
    }),
  );
  expect(view.taxAuthorization).toMatchObject({ authorized: true, noticeVersion: "demo-tax-v1" });
  view = enrichmentViewSchema.parse(
    await workflowApi(page, "POST", `${base}/requests`, {
      expectedRevision: view.revision,
      kind: "business",
    }),
  );
  console.log(
    "Hosted enrichment: synthetic input stored masked and explicit sample-tax authorization recorded.",
  );
  await expect
    .poll(
      async () => {
        view = await read();
        return ["business", "tax"].map(
          (kind) => view.runs.find((run) => !run.stale && run.kind === kind)?.status,
        );
      },
      { timeout: 120000, intervals: [3000] },
    )
    .toEqual(["succeeded", "succeeded"]);
  const business = view.runs.find((run) => !run.stale && run.kind === "business");
  const tax = view.runs.find((run) => !run.stale && run.kind === "tax");
  for (const run of [business, tax])
    expect(run?.result).toMatchObject({
      simulated: true,
      outcome: "complete",
      inputRevision: view.revision,
    });
  expect(business?.result?.suggestions).toHaveLength(2);
  expect(tax?.result?.taxRecords).toHaveLength(1);
  expect(
    tax?.result?.taxRecords.every((record) => record.availability === "sample_available"),
  ).toBe(true);
  expect(view.confirmedFacts).toHaveLength(0);
  const saved = await workflowApi<ApplicationSetup>(page, "GET", `/applications/${app.id}/setup`);
  expect(saved.businessName).toBe(app.businessName);
  expect(saved.requestedAmount).toBe(app.requestedAmount);
  expect(saved.purpose).toBe(app.purpose);
  expect(saved.revision).toBe(app.revision);
  console.log(
    "Hosted enrichment: typed simulated business/tax results succeeded; application facts and revision remain unchanged.",
  );
});
