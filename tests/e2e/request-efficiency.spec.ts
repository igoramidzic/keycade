import { readEnvironment } from "@keycade/config/server";
import { expect, test } from "@playwright/test";
import { fillSignInEmail } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const applicationId = "60000000-0000-4000-8000-000000000001";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("idle borrower overview avoids session fan-out and three-second background polling", async ({
  page,
}) => {
  await page.goto(borrower);
  await fillSignInEmail(page, "borrower@example.test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your applications", exact: true })).toBeVisible();
  await page.clock.install();
  const requests = new Map<string, number>();
  // React development StrictMode starts and aborts an extra mount fetch. Count completed reads.
  page.on("response", (response) => {
    if (!response.ok()) return;
    const path = new URL(response.url()).pathname;
    const resource =
      path === "/api/v1/auth/session"
        ? "session"
        : path.match(
            new RegExp(`/applications/${applicationId}/(tasks|documents|readiness|review)$`),
          )?.[1];
    if (resource) requests.set(resource, (requests.get(resource) ?? 0) + 1);
  });
  const loaded = Promise.all(
    ["tasks", "documents", "readiness"].map((resource) =>
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith(`/applications/${applicationId}/${resource}`) &&
          response.ok(),
      ),
    ),
  );
  await page.goto(`${borrower}/applications/${applicationId}?bank=bank-a`);
  await loaded;
  await expect(
    page.getByRole("button", { name: "Describe your business", exact: true }),
  ).toBeVisible();
  expect(requests.get("session")).toBe(1);
  expect(requests.get("tasks")).toBe(1);
  expect(requests.get("documents")).toBe(1);
  expect(requests.get("readiness")).toBe(1);
  expect(requests.get("review") ?? 0).toBe(0);
  const initial = [...requests];
  await page.clock.runFor(12_001);
  expect([...requests]).toEqual(initial);
});
