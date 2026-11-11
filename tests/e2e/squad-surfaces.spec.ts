import { test, expect, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* The fixture ticker and the captain shortlist on the Squad tab. The owner's view reads the committed
 * forecast; the guest view is served the same payload from a mocked /api/forecast, edited to hold a blank
 * and a double gameweek (the committed build has neither this week). */

const OWNER = "1168513";
const ORIGIN = `http://localhost:${process.env.PW_PORT ?? 3123}`;

function latestForecast() {
  const dir = join(__dirname, "..", "..", "data", "forecast");
  const latest = readdirSync(dir)
    .map((f) => /^gw(\d+)\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(b[1]) - Number(a[1]))[0][0];
  return JSON.parse(readFileSync(join(dir, latest), "utf8"));
}

let pageErrors: string[] = [];
test.beforeEach(async ({ context, page }) => {
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await context.addCookies([{ name: "fpl_team_id", value: OWNER, url: ORIGIN }]);
  await page.addInitScript(() => {
    try { localStorage.setItem("fpl-pitch-view", "2d"); } catch {}
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

async function openSquad(page: Page, url = "/?tab=squad") {
  await page.goto(url);
  await page.getByTestId("fixture-ticker").first().waitFor({ state: "attached" });
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const width of [360, 390]) {
  test(`owner: the ticker opens and fits ${width}px wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openSquad(page);
    const ticker = page.getByTestId("fixture-ticker");
    // collapsed by default, with the summary showing
    await expect(ticker).not.toHaveAttribute("open", "");
    const summaryBox = await ticker.locator("summary").boundingBox();
    expect(summaryBox!.height, "summary meets the 44px tap rule").toBeGreaterThanOrEqual(43.5);
    await ticker.locator("summary").click();
    const btnBox = await ticker.getByRole("button").first().boundingBox();
    expect(btnBox!.height, "row meets the 44px tap rule").toBeGreaterThanOrEqual(43.5);
    await expect(ticker.locator("[data-row=starter]")).toHaveCount(11);
    await expect(ticker.locator("[data-row=sub]")).toHaveCount(4);
    // every cell says who the opponent is in text
    await expect(ticker.locator("[data-row=starter]").first().locator("[data-cell=single]").first()).toContainText(/[A-Z]{3} [HA]/);
    expect(await noSideScroll(page), "no sideways scrolling").toBeLessThanOrEqual(1);
    await ticker.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`ticker-${width}.png`), fullPage: false });
    await test.info().attach(`ticker-${width}`, { path: test.info().outputPath(`ticker-${width}.png`), contentType: "image/png" });
  });

  test(`owner: the shortlist shows two players, More reveals the third, and marks the model's pick at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openSquad(page);
    const list = page.getByTestId("captain-shortlist");
    await expect(list.locator("li")).toHaveCount(2);
    await expect(list.locator("li[data-pick=true]")).toHaveCount(1);
    await expect(list.locator("li[data-pick=true]")).toContainText("Model pick");
    await expect(list.locator("li").first()).not.toContainText("% owned overall");
    const more = page.getByTestId("captain-more");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    expect((await more.boundingBox())!.height, "44px tap rule").toBeGreaterThanOrEqual(43.5);
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(list.locator("li")).toHaveCount(3);
    await expect(list.locator("li").first()).toContainText("% owned overall");
    await expect(page.getByText(/^Captain · GW/)).toHaveCount(0); // the old card is gone
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    await list.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`shortlist-${width}.png`) });
    await test.info().attach(`shortlist-${width}`, { path: test.info().outputPath(`shortlist-${width}.png`), contentType: "image/png" });
  });
}

test("guest: a blank and a double gameweek render, and tapping a row opens the player sheet", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.context().clearCookies();
  const f = latestForecast();
  const squadIds: number[] = f.squad.players.map((p: { id: number }) => p.id);
  const doubleId = f.upcoming[0].startingXi[3];
  const blankId = f.upcoming[1].startingXi[4];
  const doubleName = f.squad.players.find((p: { id: number }) => p.id === doubleId).webName;
  expect(squadIds).toContain(blankId);
  const extra = { team: "BUR", wasHome: false, fdrRating: 5 };
  const guest = structuredClone(f);
  guest.teamName = "Guest FC";
  guest.managerName = "A Friend";
  guest.upcoming[0].players.find((p: { id: number }) => p.id === doubleId).opponents.push(extra);
  guest.upcoming[1].players.find((p: { id: number }) => p.id === blankId).opponents = [];
  await page.route("**/api/forecast*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(guest) }),
  );
  await page.goto("/?team=999111");
  await page.getByTestId("fixture-ticker").waitFor({ state: "attached" });
  const ticker = page.getByTestId("fixture-ticker");
  await expect(ticker.locator("summary")).toContainText("1 double, 1 blank");
  await ticker.locator("summary").click();
  await expect(ticker.locator("[data-cell=blank]")).toHaveCount(1);
  await expect(ticker.locator("[data-cell=blank]").first()).toHaveText("–");
  const dbl = ticker.locator("[data-cell=double]");
  await expect(dbl).toHaveCount(1);
  await expect(dbl.locator("span.truncate")).toHaveCount(2);
  await expect(dbl).toContainText("BUR A");
  expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
  // the shortlist works from the guest payload and shows the double
  await expect(page.getByTestId("captain-shortlist").locator("li")).toHaveCount(2);
  await page.getByRole("button", { name: /^More/ }).click();
  await expect(page.getByTestId("captain-shortlist").locator("li")).toHaveCount(3);
  // tap a row: the existing player sheet opens
  const row = ticker.getByRole("button", { name: new RegExp(`^${doubleName}, show breakdown`) });
  await row.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("ticker-guest-360.png") });
});

for (const width of [360, 390]) {
  test(`owner: subs names do not break mid-word at ${width}px, History folds to 3 rows, Rebuild is last`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => { try { localStorage.setItem("fpl-pitch-view", "3d"); } catch {} });
    await openSquad(page);
    const strip = page.getByTestId("subs-strip").first();
    await strip.scrollIntoViewIfNeeded();
    const names = strip.getByTestId("sub-name");
    expect(await names.count()).toBeGreaterThan(0);
    for (const h of await names.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
      expect(h, "one line per name").toBeLessThan(16);
    // History: chart + 3 rows, then "Show all"
    const history = page.locator(".panel", { has: page.getByRole("heading", { name: "HISTORY" }) });
    await expect(history.locator("ul > li").filter({ hasText: /^GW\d+/ })).toHaveCount(3);
    const all = history.locator("button[aria-expanded]").filter({ hasText: /^Show/ });
    expect((await all.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await all.click();
    await expect(all).toHaveAttribute("aria-expanded", "true");
    expect(await history.locator("ul > li").filter({ hasText: /^GW\d+/ }).count()).toBeGreaterThan(3);
    // the record carousel sits under History, and Rebuild (owner) is the last panel
    const hy = (await history.boundingBox())!.y;
    const hb = (await history.boundingBox())!.height;
    const rec = page.getByText(/Out-of-sample · \d+ GW/i).first();
    expect((await rec.boundingBox())!.y).toBeGreaterThan(hy + hb - 1);
    const rb = page.getByTestId("rebuild").first();
    expect((await rb.boundingBox())!.y).toBeGreaterThan((await rec.boundingBox())!.y);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    await context.clearCookies();
  });
}

test("checklist: all-clear line is compact and an actionable row stays expanded; Rebuild is owner-only", async ({ page, context }) => {
  const fc = latestForecast();
  await page.clock.install({ time: Date.parse(fc.deadlineTime) - 5 * 3_600_000 });
  for (const p of fc.squad.players) p.availability = { ...p.availability, risks: [] };
  fc.squad.players[0].availability.risks = [{ kind: "suspension_risk", gameweek: null, notes: "FPL sentence." }];
  await context.clearCookies();
  await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...fc, teamName: "Guest FC" }) }));
  await page.goto("/?team=999111&tab=squad");
  const clear = page.getByTestId("checklist-all-clear");
  await expect(clear).toContainText("All clear:");
  await expect(clear).not.toContainText("suspension");
  await expect(page.getByText("Suspension / loan-ban risk (FPL)")).toBeVisible();
  const btn = page.getByRole("button", { name: /^All clear/ });
  await expect(btn).toHaveAttribute("aria-expanded", "false");
  expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await expect(page.getByTestId("rebuild")).toHaveCount(0); // guests never get it
});
