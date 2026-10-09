import { readEnvironment } from "@keycade/config/server";
import { expect, test } from "@playwright/test";
import { fillSignInEmail } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15000 });
test("borrower reminder preferences persist without disabling requested access messages", async ({
  page,
}) => {
  await page.goto(borrower);
  await fillSignInEmail(page, "borrower@example.test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your applications", exact: true })).toBeVisible();
  await page.getByText("Reminder settings", { exact: true }).click();
  const checkbox = page.getByLabel("Send me reminders", { exact: true });
  await expect(checkbox).toBeVisible();
  const initial = await checkbox.isChecked();
  await checkbox.setChecked(!initial);
  await page.getByRole("button", { name: "Save reminder settings", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Reminder settings saved." }),
  ).toBeVisible();
  await page.reload();
  await page.getByText("Reminder settings", { exact: true }).click();
  await expect(checkbox).toBeChecked({ checked: !initial });
  await expect(
    page.getByText(/Sign-in links and requested invitations are separate/),
  ).toBeVisible();
  await checkbox.setChecked(initial);
  await page.getByRole("button", { name: "Save reminder settings", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Reminder settings saved." }),
  ).toBeVisible();
});
