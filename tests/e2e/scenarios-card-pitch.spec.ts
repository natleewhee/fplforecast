import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* The 3D XI inside a Scenarios carousel card is much narrower than the Squad tab's pitch. Its name tags
 * must all stay inside the pitch, clear of each other, with the goalkeeper's tag fully visible. */

const OWNER = "1168513";
const ORIGIN = `http://localhost:${process.env.PW_PORT ?? 3123}`;

let pageErrors: string[] = [];
test.beforeEach(async ({ context, page }) => {
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await context.addCookies([{ name: "fpl_team_id", value: OWNER, url: ORIGIN }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("fpl-pitch-view", "3d");
      localStorage.setItem("fpl-pitch-passing", "off");
    } catch {}
  });
  await page.route("**/api/live*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "no live data in tests" }) }),
  );
  await page.route("**/api/recap*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "none" }) }),
  );
});
test.afterEach(() => {
  expect(pageErrors, "no uncaught page errors").toEqual([]);
});

for (const width of [360, 390]) {
  test(`scenario card squad pitch at ${width}px: every tag inside, none overlapping, keeper readable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/?tab=scenarios");
    await page.getByRole("button", { name: "5 GW", exact: true }).click();
    const disclosure = page.locator("details", { hasText: /Show my squad over these/ }).first();
    await disclosure.scrollIntoViewIfNeeded();
    await disclosure.locator("summary").click();
    const pitch = disclosure.getByTestId("pitch3d");
    await pitch.scrollIntoViewIfNeeded();
    await expect(pitch.locator("canvas")).toBeVisible();
    const tags = pitch.locator("button[data-tag]:not([data-pitch-off])").filter({ hasNot: page.locator("[data-never]") });
    // starters only: the subs strip sits outside the host
    const host = pitch.locator("canvas").locator("xpath=..");
    await expect.poll(async () => host.locator("[data-tag]").count()).toBe(11);
    await page.waitForTimeout(600);
    void tags;
    const hb = (await host.boundingBox())!;
    const boxes = await host.locator("[data-tag]").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.getAttribute("data-tag"), text: (e.textContent ?? "").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    await page.screenshot({ path: `test-results/scenario-card-pitch-${width}.png` });
    await pitch.screenshot({ path: `test-results/scenario-card-pitch-only-${width}.png` });
    expect(boxes).toHaveLength(11);
    for (const b of boxes) {
      expect(b.x, `${b.text} left`).toBeGreaterThanOrEqual(hb.x - 0.5);
      expect(b.y, `${b.text} top`).toBeGreaterThanOrEqual(hb.y - 0.5);
      expect(b.x + b.w, `${b.text} right`).toBeLessThanOrEqual(hb.x + hb.width + 0.5);
      expect(b.y + b.h, `${b.text} bottom`).toBeLessThanOrEqual(hb.y + hb.height + 0.5);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        const overlap = a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
        expect(overlap, `${a.text} / ${c.text} overlap`).toBe(false);
      }
    }
  });
}

test("Live tab 3D pitch at 390px: no two name tags overlap and all stay inside", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/live*", (route) =>
    route.request().url().includes("squad=1")
      ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
      : route.fulfill({ contentType: "application/json", body: readFileSync(join(__dirname, "fixtures", "live-a.json"), "utf8") }),
  );
  await page.goto("/?tab=live");
  await page.getByRole("button", { name: /^Van Dijk,/ }).waitFor();
  const pitch = page.getByTestId("pitch3d").first();
  await pitch.scrollIntoViewIfNeeded();
  await expect(pitch.locator("canvas")).toBeVisible();
  const host = pitch.locator("canvas").locator("xpath=..");
  await expect.poll(async () => host.locator("[data-tag]").count()).toBe(11);
  await page.waitForTimeout(600);
  const hb = (await host.boundingBox())!;
  const boxes = await host.locator("[data-tag]:not([data-pitch-off])").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { text: (e.textContent ?? "").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  await pitch.screenshot({ path: "test-results/live-pitch-390.png" });
  for (const b of boxes) {
    expect(b.x, `${b.text} left`).toBeGreaterThanOrEqual(hb.x - 0.5);
    expect(b.y, `${b.text} top`).toBeGreaterThanOrEqual(hb.y - 0.5);
    expect(b.x + b.w, `${b.text} right`).toBeLessThanOrEqual(hb.x + hb.width + 0.5);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j];
      expect(a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h, `${a.text} / ${c.text} overlap`).toBe(false);
    }
});
