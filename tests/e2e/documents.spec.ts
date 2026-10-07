import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readEnvironment } from "@keycade/config/server";
import { syntheticDocumentPdf } from "@keycade/integrations/document-fixtures";
import { expect, type Page, test } from "@playwright/test";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const applicationId = "60000000-0000-4000-8000-000000000001";
const pdf = Buffer.from(syntheticDocumentPdf("clean-statement"));
const file = (name: string) => ({ name, mimeType: "application/pdf", buffer: pdf });
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(90_000);

async function signIn(page: Page, origin: string, email: string) {
  await page.goto(origin);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: origin === staff ? "Applications" : "Your applications",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`${origin}/applications/${applicationId}/documents?bank=bank-a`);
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
async function dropPdf(page: Page, name: string) {
  const transfer = await page.evaluateHandle(
    ({ content, name }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], name, { type: "application/pdf" }));
      return transfer;
    },
    { content: pdf.toString(), name },
  );
  await page
    .getByRole("region", { name: "Document upload drop area" })
    .dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
}

for (const [label, origin, email] of [
  ["borrower", borrower, "borrower@example.test"],
  ["staff", staff, "officer-a@example.test"],
] as const) {
  test(`${label} uploads with keyboard and drag/drop, downloads clean bytes, and replaces an immutable version`, async ({
    page,
  }, testInfo) => {
    await signIn(page, origin, email);
    const name = `synthetic-${label}-${randomUUID().slice(0, 8)}.pdf`;
    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose files", exact: true }).focus();
    await page.keyboard.press("Enter");
    await (await choosing).setFiles(file(name));
    const uploaded = page.getByRole("listitem", { name: `Upload ${name}`, exact: true });
    await expect(uploaded).toContainText("Uploaded.");
    const saved = page.getByRole("listitem", { name: `Document ${name}`, exact: true });
    await expect(saved).toContainText("Simulated scan clean", { timeout: 25_000 });
    const downloading = page.waitForEvent("download");
    await saved.getByRole("button", { name: "Download", exact: true }).click();
    const downloaded = await downloading;
    expect(downloaded.suggestedFilename()).toBe(name);
    const downloadedPath = await downloaded.path();
    if (!downloadedPath) throw new Error("Expected a downloaded synthetic file.");
    expect(await readFile(downloadedPath)).toEqual(pdf);

    const droppedName = `synthetic-dropped-${randomUUID().slice(0, 8)}.pdf`;
    await dropPdf(page, droppedName);
    await expect(
      page.getByRole("listitem", { name: `Document ${droppedName}`, exact: true }),
    ).toContainText("Simulated scan clean", { timeout: 25_000 });

    const replacing = page.waitForEvent("filechooser");
    await saved.getByRole("button", { name: "Upload replacement", exact: true }).click();
    const replacementName = `replacement-${randomUUID().slice(0, 8)}.pdf`;
    await (await replacing).setFiles(file(replacementName));
    const replaced = page.getByRole("listitem", {
      name: `Document ${replacementName}`,
      exact: true,
    });
    await expect(replaced).toContainText("Version 2");
    await expect(replaced.locator('[data-slot="badge"]').first()).toHaveText(
      "Simulated scan clean",
      { timeout: 25_000 },
    );
    await replaced.getByText("Previous versions (1)", { exact: true }).click();
    await expect(replaced.getByText(name, { exact: true })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`synthetic-${label}-documents.png`),
      fullPage: true,
    });
  });
}

test("partial upload failure preserves a valid file and retries a lost upload acknowledgement without a duplicate", async ({
  page,
}) => {
  await signIn(page, borrower, "borrower@example.test");
  const good = `synthetic-good-${randomUUID().slice(0, 8)}.pdf`;
  const spoof = `synthetic-spoof-${randomUUID().slice(0, 8)}.pdf`;
  await page.getByLabel("Choose document files", { exact: true }).setInputFiles([
    file(good),
    {
      name: spoof,
      mimeType: "application/pdf",
      buffer: Buffer.from("This is synthetic text, not a PDF."),
    },
  ]);
  await expect(page.getByRole("listitem", { name: `Upload ${good}`, exact: true })).toContainText(
    "Uploaded.",
  );
  await expect(
    page.getByRole("listitem", { name: `Upload ${spoof}`, exact: true }).getByRole("alert"),
  ).toBeVisible();
  await expect(page.getByRole("listitem", { name: `Document ${good}`, exact: true })).toContainText(
    "Simulated scan clean",
    { timeout: 25_000 },
  );
  const acknowledged = `synthetic-retry-${randomUUID().slice(0, 8)}.pdf`;
  const pattern = /\/documents\/uploads\/[^/]+\/content$/;
  let intercepted = false;
  await page.route(pattern, async (route) => {
    if (!intercepted) {
      intercepted = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "UNAVAILABLE",
            message: "The acknowledgement was interrupted. Retry this file.",
          },
        },
      });
    } else await route.continue();
  });
  await page.getByLabel("Choose document files", { exact: true }).setInputFiles(file(acknowledged));
  const retry = page.getByRole("listitem", { name: `Upload ${acknowledged}`, exact: true });
  await expect(retry.getByRole("alert")).toContainText("acknowledgement");
  await retry.getByRole("button", { name: "Retry upload", exact: true }).click();
  await expect(retry).toContainText("Uploaded.");
  await expect(
    page.getByRole("listitem", { name: `Document ${acknowledged}`, exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("listitem", { name: `Document ${acknowledged}`, exact: true }),
  ).toContainText("Version 1");
  await page.unroute(pattern);
  await noOverflow(page);
});

test("an in-flight upload can be cancelled and retried independently", async ({ page }) => {
  await signIn(page, staff, "officer-a@example.test");
  const name = `synthetic-cancel-${randomUUID().slice(0, 8)}.pdf`;
  const pattern = /\/documents\/uploads\/[^/]+\/content$/;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    await held;
    await route.continue().catch(() => undefined);
  });
  try {
    const sent = page.waitForRequest(
      (request) => request.method() === "PUT" && pattern.test(request.url()),
    );
    await page.getByLabel("Choose document files", { exact: true }).setInputFiles(file(name));
    await sent;
    const upload = page.getByRole("listitem", { name: `Upload ${name}`, exact: true });
    await expect(upload.getByRole("progressbar")).toBeVisible();
    await upload.getByRole("button", { name: "Cancel upload", exact: true }).click();
    await expect(upload).toContainText("Upload cancelled.");
    release();
    await page.unroute(pattern);
    await upload.getByRole("button", { name: "Retry upload", exact: true }).click();
    await expect(upload).toContainText("Uploaded.");
    await expect(
      page
        .getByRole("listitem", { name: `Document ${name}`, exact: true })
        .filter({ hasText: "Simulated scan clean" }),
    ).toHaveCount(1, { timeout: 25_000 });
    await noOverflow(page);
  } finally {
    release();
    await page.unroute(pattern);
  }
});

test("blocked and failed simulated scans stay quarantined and a transient scan can be retried", async ({
  page,
}) => {
  await signIn(page, borrower, "borrower@example.test");
  const blockedName = `synthetic-blocked-${randomUUID().slice(0, 8)}.pdf`;
  const retryName = `synthetic-scan-retry-${randomUUID().slice(0, 8)}.pdf`;
  await page.getByLabel("Choose document files", { exact: true }).setInputFiles([
    {
      name: blockedName,
      mimeType: "application/pdf",
      buffer: Buffer.from(syntheticDocumentPdf("blocked")),
    },
    {
      name: retryName,
      mimeType: "application/pdf",
      buffer: Buffer.from(syntheticDocumentPdf("scan-transient")),
    },
  ]);
  const blocked = page.getByRole("listitem", { name: `Document ${blockedName}`, exact: true });
  const retry = page.getByRole("listitem", { name: `Document ${retryName}`, exact: true });
  await expect(blocked).toContainText("Blocked by simulated scan", { timeout: 25_000 });
  await expect(blocked.getByRole("button", { name: "Download", exact: true })).toHaveCount(0);
  await expect(retry).toContainText("Simulated scan failed", { timeout: 25_000 });
  await expect(retry.getByRole("button", { name: "Download", exact: true })).toHaveCount(0);
  await retry.getByRole("button", { name: "Retry simulated scan", exact: true }).click();
  await expect(retry).toContainText("Simulated scan clean", { timeout: 25_000 });
  await expect(retry.getByRole("button", { name: "Download", exact: true })).toBeVisible();
  await noOverflow(page);
});

test("documents load inside an assigned task and denied lists have a retry path", async ({
  page,
}) => {
  await signIn(page, borrower, "borrower@example.test");
  await page.goto(`${borrower}/applications/${applicationId}/tasks?bank=bank-a`);
  await page.getByRole("button", { name: "Describe your business", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Task documents", exact: true })).toBeVisible();
  const name = `synthetic-task-${randomUUID().slice(0, 8)}.pdf`;
  await page.getByLabel("Choose document files", { exact: true }).setInputFiles(file(name));
  await expect(page.getByRole("listitem", { name: `Document ${name}`, exact: true })).toContainText(
    "Describe your business",
  );
  const pattern = /\/documents$/;
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: "FORBIDDEN", message: "Your document access changed." } },
    }),
  );
  await page.goto(`${borrower}/applications/${applicationId}/documents?bank=bank-a`);
  await expect(page.getByRole("alert")).toContainText("Your document access changed.");
  await expect(page.getByRole("region", { name: "Saved documents" })).toHaveCount(0);
  await page.unroute(pattern);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  await noOverflow(page);
});
