import { readEnvironment } from "@keycade/config/server";
import { expect, test } from "@playwright/test";

const env = readEnvironment();
const workspaces = [
  {
    name: "Keycade Bank",
    brand: "Synthetic Bank A",
    port: env.BANK_SITE_PORT ?? 3000,
  },
  {
    name: "Borrower Portal",
    brand: "Keycade Bank",
    port: env.BORROWER_PORT ?? 3001,
  },
  {
    name: "Bank Console",
    brand: "Keycade Bank Console",
    port: env.BANK_CONSOLE_PORT ?? 3002,
  },
];

for (const workspace of workspaces) {
  test(`${workspace.name} serves its workspace and connects to real services`, async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.goto(`http://127.0.0.1:${workspace.port}`);
    await expect(
      page.getByRole("banner").getByRole("link", { name: workspace.brand }),
    ).toBeVisible();
    // The public lending, borrower, and staff screens focus on their application journeys.
    // Their same-origin service boundary still reaches the real local services.
    for (const endpoint of ["/api/health", "/api/ready"]) {
      const response = await page.request.get(`http://127.0.0.1:${workspace.port}${endpoint}`);
      expect(response.ok()).toBe(true);
      expect((await response.json()).status).toMatch(/^(ok|ready)$/);
    }
    // The shared styles must render at both viewport sizes without sideways scrolling.
    const layout = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
      fontFamily: getComputedStyle(document.body).fontFamily,
    }));
    expect(layout.contentWidth).toBeLessThanOrEqual(layout.width);
    expect(layout.fontFamily).toContain("Geist");

    if (workspace.name === "Keycade Bank") {
      await page.getByRole("link", { name: "Continue an application", exact: true }).click();
      await expect(page).toHaveURL(`http://127.0.0.1:${env.BORROWER_PORT ?? 3001}/?bank=bank-a`);
      await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
      await page
        .getByRole("banner")
        .getByRole("link", { name: "Keycade Bank", exact: true })
        .click();
      await page.getByRole("link", { name: "Bank staff sign-in", exact: true }).click();
      await expect(page).toHaveURL(`http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}/`);
    } else if (workspace.name === "Borrower Portal") {
      await page
        .getByRole("banner")
        .getByRole("link", { name: "Keycade Bank", exact: true })
        .click();
      await expect(page).toHaveURL(`http://127.0.0.1:${env.BANK_SITE_PORT ?? 3000}/`);
    } else {
      await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
      await page.getByRole("banner").getByRole("link", { name: workspace.brand }).click();
      await expect(page).toHaveURL(`http://127.0.0.1:${workspace.port}/?bank=bank-a`);
      await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test("staff sign-in explains service failure and retries the real API", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) => route.abort());
  await page.goto(`http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`);
  await expect(page.getByText("Sign-in is temporarily unavailable", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(0);

  await page.unroute("**/api/v1/auth/session");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
});

test("an HTML fallback cannot masquerade as an available staff session", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html>shell</html>" }),
  );
  await page.goto(`http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`);
  await expect(page.getByText("Sign-in is temporarily unavailable", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(0);
});
