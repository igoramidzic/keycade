import { expect, type Page } from "@playwright/test";

/** The active participant's card, identified by email and its actions menu. */
export function participantCard(page: Page, email: string) {
  return page
    .getByRole("listitem")
    .filter({ hasText: email })
    .filter({ has: page.getByRole("button", { name: /^Actions for (?!invitation)/ }) });
}

/** Removes a participant through their card menu and the confirmation dialog. */
export async function removeAccess(page: Page, email: string) {
  await participantCard(page, email)
    .getByRole("button", { name: /^Actions for / })
    .click();
  await page.getByRole("menuitem", { name: "Remove access", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("button", { name: "Remove access", exact: true }).click();
  await expect(confirm).toBeHidden();
}
