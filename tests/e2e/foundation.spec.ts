import { readEnvironment } from "@keycade/config/server";
import { expect, test } from "@playwright/test";

const env = readEnvironment();
const workspaces = [
  {
    name: "Keycade Bank",
    brand: "Synthetic Bank A",
    label: "Mock bank site",
    port: env.BANK_SITE_PORT ?? 3000,
  },
  {
    name: "Borrower Portal",
    brand: "Keycade Bank",
    label: "Borrower workspace",
    port: env.BORROWER_PORT ?? 3001,
  },
  {
    name: "Bank Console",
    brand: "Bank Console",
    label: "Staff workspace",
    port: env.BANK_CONSOLE_PORT ?? 3002,
  },
];

for (const workspace of workspaces) {
  test(`${workspace.name} connects to real services and navigates between apps`, async ({
    page,
  }) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.goto(`http://127.0.0.1:${workspace.port}`);
    await expect(
      page.getByRole("banner").getByRole("link", { name: workspace.brand }),
    ).toBeVisible();
    // The public lending and borrower screens now focus on the application journey.
    // Their same-origin service boundary still reaches the real local services.
    for (const endpoint of ["/api/health", "/api/ready"]) {
      const response = await page.request.get(`http://127.0.0.1:${workspace.port}${endpoint}`);
      expect(response.ok()).toBe(true);
      expect((await response.json()).status).toMatch(/^(ok|ready)$/);
    }
    if (workspace.name === "Bank Console") {
      await expect(page.getByText("Connected", { exact: true })).toHaveCount(2);
      await page.getByRole("button", { name: "Refresh checks" }).click();
      await expect(page.getByText("Connected", { exact: true })).toHaveCount(2);
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
      for (const destination of workspaces) {
        await page.goto(`http://127.0.0.1:${workspace.port}/`);
        await page
          .getByRole("navigation", { name: "Applications" })
          .getByRole("link", { name: destination.label })
          .click();
        await expect(page).toHaveURL(`http://127.0.0.1:${destination.port}/`);
        await expect(
          page.getByRole("banner").getByRole("link", { name: destination.brand }),
        ).toBeVisible();
      }
    }
    expect(errors).toEqual([]);
  });
}

test("a failed connection is visible and refresh reconnects to the real API", async ({ page }) => {
  await page.route("**/api/health", (route) => route.abort());
  await page.route("**/api/ready", (route) =>
    route.fulfill({ status: 503, json: { status: "not_ready" } }),
  );
  await page.goto(`http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`);
  await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(2);
  await expect(page.getByText("A service is unavailable.", { exact: false })).toBeVisible();

  await page.unroute("**/api/health");
  await page.unroute("**/api/ready");
  await page.getByRole("button", { name: "Refresh checks" }).click();
  await expect(page.getByText("Connected", { exact: true })).toHaveCount(2);
});

test("an HTML fallback cannot masquerade as a healthy API", async ({ page }) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html>shell</html>" }),
  );
  await page.goto(`http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`);
  await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Connected", { exact: true })).toHaveCount(1);
});
