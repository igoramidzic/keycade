import { expect, type Page } from "@playwright/test";

export async function completeAddressAndSkipOptional(page: Page) {
  for (const [label, value] of [
    ["Street address", "100 Demo Street"],
    ["City", "Portland"],
    ["State or region", "ME"],
    ["Postal code", "04101"],
    ["Country code", "US"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const label of ["Business EIN", "Industry", "Website"]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  }
  await expect(page.getByLabel("Requested amount", { exact: true })).toBeVisible();
}
