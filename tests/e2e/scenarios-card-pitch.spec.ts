import { test, expect, type Locator, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
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

type Box = { text: string; x: number; y: number; w: number; h: number };
const boxesOf = (host: Locator) =>
  host.locator("[data-tag]:not([data-pitch-off])").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { text: (e.textContent ?? "").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  ) as Promise<Box[]>;

function expectClean(boxes: Box[], hb: { x: number; y: number; width: number; height: number }, label: string) {
  expect(boxes, `${label}: eleven tags`).toHaveLength(11);
  for (const b of boxes) {
    expect(b.x, `${label} ${b.text} left`).toBeGreaterThanOrEqual(hb.x - 0.5);
    expect(b.y, `${label} ${b.text} top`).toBeGreaterThanOrEqual(hb.y - 0.5);
    expect(b.x + b.w, `${label} ${b.text} right`).toBeLessThanOrEqual(hb.x + hb.width + 0.5);
    expect(b.y + b.h, `${label} ${b.text} bottom`).toBeLessThanOrEqual(hb.y + hb.height + 0.5);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j];
      expect(a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h, `${label}: ${a.text} / ${c.text} overlap`).toBe(false);
    }
}

async function openCard(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.getByRole("button", { name: "5 GW", exact: true }).click();
  const disclosure = page.locator("details", { hasText: /Show my squad over these/ }).first();
  await disclosure.scrollIntoViewIfNeeded();
  await disclosure.locator("summary").click();
  const pitch = disclosure.getByTestId("pitch3d");
  await pitch.scrollIntoViewIfNeeded();
  await expect(pitch.locator("canvas")).toBeVisible();
  const host = pitch.locator("canvas").locator("xpath=..");
  await expect.poll(async () => host.locator("[data-tag]").count()).toBe(11);
  // the plan's transfers are acted out first (men running on and off): measure the settled pitch
  await expect(pitch).not.toHaveAttribute("data-settling", /.*/, { timeout: 15000 });
  await page.waitForTimeout(600);
  return { pitch, host };
}

for (const width of [360, 390]) {
  test(`scenario card squad pitch at ${width}px: every tag inside, none overlapping, keeper readable`, async ({ page }) => {
    await page.goto("/?tab=scenarios");
    const { pitch, host } = await openCard(page, width);
    const hb = (await host.boundingBox())!;
    await page.screenshot({ path: `test-results/scenario-card-pitch-${width}.png` });
    await pitch.screenshot({ path: `test-results/scenario-card-pitch-only-${width}.png` });
    expectClean(await boxesOf(host), hb, `${width}px`);
  });
}

// Long surnames in four formations: a guest forecast is served from a mocked /api/forecast so the squad and XI can be edited.
const FORMATIONS: Record<string, [number, number, number]> = { "4-4-2": [4, 4, 2], "3-5-2": [3, 5, 2], "5-3-2": [5, 3, 2], "5-4-1": [5, 4, 1] };
const LONG = ["Muharemovic", "Alexander-Arnold", "Wan-Bissaka", "Trent-Alexander", "Mac Allister", "Bruno Fernandes", "Kluivert-Mbeumo", "Rodrigo Hernandez", "Haverts-Nwaneri", "Calafiori-Saliba", "Bogarde-Konsa", "Sa Pinto-Lamptey", "Gyokeres-Isak", "Huijsen-Lacroix", "Onana-Pickford"];
for (const [name, [d, m, f]] of Object.entries(FORMATIONS)) {
  for (const width of [360, 390]) {
    test(`${name} with long names in the scenario card at ${width}px`, async ({ page }) => {
      const dir = join(__dirname, "..", "..", "data", "forecast");
      const newest = readdirSync(dir).filter((x) => /^gw\d+\.json$/.test(x)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))[0];
      const fc = JSON.parse(readFileSync(join(dir, newest), "utf8"));
      const byId = new Map<number, { id: number; position: string; webName: string }>(fc.pool.map((p: { id: number; position: string; webName: string }) => [p.id, p]));
      const sc = fc.scenarios.byHorizon["5"][0];
      sc.squad.forEach((id: number, i: number) => {
        const p = byId.get(id);
        if (p) p.webName = LONG[i % LONG.length];
      });
      const pick = (pos: string, n: number) => sc.squad.filter((id: number) => byId.get(id)?.position === pos).slice(0, n);
      const xi = [...pick("GKP", 1), ...pick("DEF", d), ...pick("MID", m), ...pick("FWD", f)];
      sc.xiByGw = sc.xiByGw.map(() => xi);
      await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fc) }));
      await page.goto("/?team=999999&tab=scenarios");
      const { host } = await openCard(page, width);
      const hb = (await host.boundingBox())!;
      await page.screenshot({ path: `test-results/scenario-card-${name}-${width}.png` });
      expectClean(await boxesOf(host), hb, `${name} ${width}px`);
    });
  }
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
  const boxes = await boxesOf(host);
  await pitch.screenshot({ path: "test-results/live-pitch-390.png" });
  expectClean(boxes, hb, "live");
});
