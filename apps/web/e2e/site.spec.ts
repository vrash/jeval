import { expect, test } from "@playwright/test";

test("homepage renders hero, actions and code example", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Know when your AI gets it wrong.");
  await expect(page.getByRole("link", { name: "Get started" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Join the Cloud waitlist" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try the demo" })).toBeVisible();
  await expect(page.getByText("examples/sdk-example.ts")).toBeVisible();
  await expect(page.getByText("Illustrative demo: simulated results")).toBeVisible();
});

test("navigation works on desktop and mobile", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("navigation", { name: "Primary mobile" }).getByRole("link", { name: "Docs" }).click();
  } else {
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Docs" }).click();
  }
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Documentation");
  await page.getByRole("navigation", { name: "Documentation" }).getByRole("link", { name: "Rubrics" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rubrics");
});

test("keyboard users can reach the skip link and primary actions", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard navigation is a desktop check");
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("demo runs a preset in simulated mode and shows outcomes", async ({ page }) => {
  await page.goto("/demo");
  const demo = page.getByRole("region", { name: "Interactive example" });
  await expect(demo.getByRole("radio", { name: "Live (off)" })).toBeDisabled();
  await demo.getByRole("radio", { name: /Booking confirmed, but the tool failed/ }).check();
  await demo.getByRole("button", { name: "Run checks" }).click();
  await expect(demo.getByText("Simulated result", { exact: true })).toBeVisible();
  const bookingRow = demo.locator("li", { hasText: "booking-claim" }).first();
  await expect(bookingRow.locator("summary")).toContainText("Fail");
  await bookingRow.locator("summary").click();
  await expect(bookingRow.getByText(/claims success but tool event t1 status=failure/)).toBeVisible();

  await demo.getByRole("radio", { name: /reference material missing/ }).check();
  await demo.getByRole("button", { name: "Run checks" }).click();
  const claimRow = demo.locator("li", { hasText: "claim-support" }).first();
  await expect(claimRow.locator("summary")).toContainText("Review");
});

test("demo respects check selection", async ({ page }) => {
  await page.goto("/demo");
  const demo = page.getByRole("region", { name: "Interactive example" });
  await demo.getByRole("checkbox", { name: /policy-compliance/ }).uncheck();
  await demo.getByRole("checkbox", { name: /claim-support/ }).uncheck();
  await demo.getByRole("checkbox", { name: /no-unverified-promises/ }).uncheck();
  await demo.getByRole("button", { name: "Run checks" }).click();
  await expect(demo.locator("li", { hasText: "booking-claim" }).first()).toBeVisible();
  await expect(demo.locator("li", { hasText: "policy-compliance" })).toHaveCount(0);
});

test.describe("waitlist form", () => {
  test("validates locally and shows the honest unavailable state when there is no database", async ({ page }) => {
    await page.goto("/cloud");
    const form = page.locator("form").first();
    await form.getByLabel("Email").fill("not-an-email");
    await form.getByRole("button", { name: "Join the Cloud waitlist" }).click();
    await expect(form.getByRole("alert")).toHaveText("Enter a valid email address.");
    await form.getByLabel("Email").fill("jeval-e2e-test@example.com");
    await form.getByRole("button", { name: "Join the Cloud waitlist" }).click();
    // no SUPABASE_* configured in the test server → 503 with unavailable:true
    await expect(form.getByRole("alert")).toContainText("temporarily unavailable");
  });

  test("shows success when the server accepts the signup", async ({ page }) => {
    await page.route("**/api/waitlist", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, message: "You're on the list. We'll email you about jeval Cloud early access." }) }),
    );
    await page.goto("/cloud");
    const form = page.locator("form").first();
    await form.getByLabel("Email").fill("jeval-e2e-test@example.com");
    await form.getByLabel(/What would you use jeval to evaluate/).fill("support bot");
    await form.getByRole("button", { name: "Join the Cloud waitlist" }).click();
    await expect(form.getByRole("status")).toContainText("You're on the list");
  });

  test("shows a network-failure state", async ({ page }) => {
    await page.route("**/api/waitlist", (route) => route.abort());
    await page.goto("/cloud");
    const form = page.locator("form").first();
    await form.getByLabel("Email").fill("jeval-e2e-test@example.com");
    await form.getByRole("button", { name: "Join the Cloud waitlist" }).click();
    await expect(form.getByRole("alert")).toContainText("Network error");
  });

  test("shows the rate-limited state", async ({ page }) => {
    await page.route("**/api/waitlist", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ ok: false, message: "Too many attempts. Please try again later." }) }));
    await page.goto("/cloud");
    const form = page.locator("form").first();
    await form.getByLabel("Email").fill("jeval-e2e-test@example.com");
    await form.getByRole("button", { name: "Join the Cloud waitlist" }).click();
    await expect(form.getByRole("alert")).toContainText("Too many attempts");
  });
});

test("privacy, sitemap and robots exist", async ({ request, page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBeTruthy();
  expect(await sitemap.text()).toContain("/docs/quickstart");
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBeTruthy();
  // not a production deployment → disallow everything
  expect(await robots.text()).toContain("Disallow: /");
  const og = await request.get("/opengraph-image");
  expect(og.headers()["content-type"]).toContain("image/png");
});

test("demo API refuses live requests when live mode is disabled", async ({ request }) => {
  const status = await request.get("/api/demo");
  expect((await status.json()).live).toBe(false);
  const res = await request.post("/api/demo", { data: { presetId: "booking-success", rubricIds: ["booking-claim"] } });
  expect(res.status()).toBe(503);
  expect((await res.json()).error).toBe("live_disabled");
});
