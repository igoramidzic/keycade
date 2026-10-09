import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, type Page, test } from "@playwright/test";
import { fillSignInEmail } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(75_000);

async function industryStep(page: Page) {
  await page.goto(`${borrower}/apply?bank=bank-a`);
  await fillSignInEmail(page, `industry-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Start application", exact: true }).click();
  await page.getByLabel("Legal business name", { exact: true }).fill("Synthetic Dental Office");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const [label, value] of [
    ["Street address", "100 Demo Street"],
    ["City", "Portland"],
    ["State or region", "ME"],
    ["Postal code", "04101"],
    ["Country code", "US"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByLabel("Industry", { exact: true })).toBeVisible();
}

async function savedIndustry(page: Page) {
  return page.evaluate(async () => {
    const session = await (await fetch("/api/v1/auth/session")).json();
    const applicationId = location.pathname.split("/")[2];
    const setup = await (
      await fetch(`/api/v1/banks/${session.bank.id}/applications/${applicationId}/setup`)
    ).json();
    return {
      code: setup.industryCode,
      version: setup.industryTaxonomyVersion,
      skipped: setup.skippedSteps,
    };
  });
}

test("industry search supports keyboard selection, exact persistence, no match and optional skip", async ({
  page,
}) => {
  await industryStep(page);
  const trigger = page.getByLabel("Industry", { exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("combobox", { name: "Search industries", exact: true });
  await expect(search).toBeFocused();
  await search.fill("dentstry ofice");
  await expect(page.getByRole("option", { name: /Offices of Dentists.*621210/ })).toBeVisible();
  expect((await savedIndustry(page)).code).toBeNull();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText("Offices of Dentists (621210)");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What is your business website?" })).toBeVisible();
  expect(await savedIndustry(page)).toMatchObject({ code: "621210", version: "2022" });
  await expect(page.getByText(/NAICS 621210/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit industry", exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByLabel("Website", { exact: true }).fill("https://unsaved.example.test");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Replace saved industry", exact: true }).click();
  await trigger.click();
  await search.fill("zzzxxyykkqq");
  await expect(
    page.getByText("No matching industries. Try another description or skip for now."),
  ).toBeVisible();
  expect((await savedIndustry(page)).code).toBe("621210");
  await search.fill("621210");
  await expect(page.getByRole("option", { name: /Offices of Dentists/ })).toBeVisible();
  const bounds = await page.locator('[data-slot="combobox-content"]').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
    (page.viewportSize()?.width ?? 0) + 1,
  );
  await page.keyboard.press("Escape");
  await expect(search).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What is your business website?" })).toBeVisible();
  expect(await savedIndustry(page)).toMatchObject({ code: "621210", version: "2022" });
  await expect(page.getByLabel("Website", { exact: true })).toHaveValue(
    "https://unsaved.example.test/",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Clear saved industry", exact: true }).click();
  expect(await savedIndustry(page)).toMatchObject({ code: null, version: null });
  expect((await savedIndustry(page)).skipped).toContain("industry");
});

test("industry search retains the query on retry and ignores out-of-order results", async ({
  page,
}) => {
  // Only the lazy local search module is replaced. Exercise real combobox state and
  // backend selection guards with controlled network/provider timing and failures.
  await page.route("**/*industry-search*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `let failed = false;
      export async function searchIndustries(query) {
        if (query === "retry dentist" && !failed) { failed = true; throw new Error("Synthetic search failure"); }
        if (query === "slow") await new Promise(resolve => setTimeout(resolve, 600));
        else await new Promise(resolve => setTimeout(resolve, 30));
        return query === "slow"
          ? [{code:"541511",title:"Custom Computer Programming Services",taxonomyVersion:"2022"}]
          : [{code:"621210",title:"Offices of Dentists",taxonomyVersion:"2022"}];
      }`,
    }),
  );
  await industryStep(page);
  const trigger = page.getByLabel("Industry", { exact: true });
  await trigger.click();
  const search = page.getByRole("combobox", { name: "Search industries", exact: true });
  await search.fill("retry dentist");
  await expect(
    page.getByText("Industry search is unavailable. Your search is kept."),
  ).toBeVisible();
  await expect(search).toHaveValue("retry dentist");
  await page.getByRole("button", { name: "Retry industry search", exact: true }).click();
  await expect(page.getByRole("option", { name: /Offices of Dentists/ })).toBeVisible();
  await expect(search).toHaveValue("retry dentist");
  await search.fill("slow");
  await expect(page.getByText("Searching industries…")).toBeVisible();
  await search.fill("dentistry office");
  await expect(page.getByRole("option", { name: /Offices of Dentists/ })).toBeVisible();
  // Wait for the controlled stale result to settle, then verify it did not win.
  await page.waitForTimeout(700);
  await expect(page.getByRole("option", { name: /Custom Computer Programming/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Offices of Dentists/ })).toBeVisible();
  await expect(search).toHaveValue("dentistry office");
  await page.keyboard.press("Escape");
  await expect(trigger).toContainText("Choose an industry");
  expect((await savedIndustry(page)).code).toBeNull();
});
