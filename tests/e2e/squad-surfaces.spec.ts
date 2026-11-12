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
    // a name wraps between words at most (two lines), and is never cut mid-word
    for (const c of await names.evaluateAll((els) => els.map((e) => ({ clipped: e.scrollWidth - e.clientWidth, h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight), text: e.textContent ?? "" }))))
      {
        expect(c.clipped, `${c.text} fits its tile`).toBeLessThanOrEqual(1);
        expect(c.h, `${c.text} is at most two lines`).toBeLessThanOrEqual(2 * c.lh + 1);
      }
    for (const h of await strip.locator("button, [role=group]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
      expect(h, "sub tile meets the 44px rule").toBeGreaterThanOrEqual(43.5);
    // History: chart + 3 rows, then "Show all"
    const history = page.locator(".panel", { has: page.getByRole("heading", { name: "HISTORY" }) });
    await expect(history.locator("ul > li").filter({ hasText: /^GW\d+/ })).toHaveCount(3);
    const all = history.locator("button[aria-expanded]").filter({ hasText: /^Show/ });
    expect((await all.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await all.click();
    await expect(all).toHaveAttribute("aria-expanded", "true");
    expect(await history.locator("ul > li").filter({ hasText: /^GW\d+/ }).count()).toBeGreaterThan(3);
    // par calibration sits under History, and Rebuild (owner) is the last panel
    const hy = (await history.boundingBox())!.y;
    const hb = (await history.boundingBox())!.height;
    const rec = page.getByText(/Par calibration · \d+ GW/i).first();
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

type P = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type FC = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const guestWith = (mutate: (fc: FC) => void) => async (page: Page, context: import("@playwright/test").BrowserContext, width = 390) => {
  const fc = latestForecast();
  mutate(fc);
  await page.setViewportSize({ width, height: 844 });
  await page.clock.install({ time: Date.parse(fc.deadlineTime) - 5 * 3_600_000 });
  await context.clearCookies();
  await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...fc, teamName: "Guest FC" }) }));
  await page.goto("/?team=999111&tab=squad");
  await page.getByTestId("fixture-ticker").first().waitFor({ state: "attached" });
};

test("checklist: price data on 1 of 15 players is never folded into 'all clear'", async ({ page, context }) => {
  await guestWith((fc) => {
    fc.squad.players.forEach((p: P, i: number) => { p.priceWatch = i === 0 ? { percent: 3, likelihood: 0, hourlyRate: 0, changeThisGw: 0, netTransfers: 10 } : undefined; });
  })(page, context);
  await expect(page.getByTestId("checklist-all-clear")).not.toContainText("price");
  await expect(page.getByText("Price changes (FPL)")).toBeVisible();
  await expect(page.getByText(/No price data for 14/)).toBeVisible();
});

test("checklist: a player who already fell this GW keeps the price row open", async ({ page, context }) => {
  await guestWith((fc) => {
    fc.squad.players.forEach((p: P, i: number) => { p.priceWatch = { percent: 3, likelihood: 0, hourlyRate: 0, changeThisGw: i === 0 ? -1 : 0, netTransfers: 10 }; });
  })(page, context);
  await expect(page.getByTestId("checklist-all-clear")).not.toContainText("price");
  await expect(page.getByText(/Already fell this GW/)).toBeVisible();
});

test("checklist: no captain picked is shown, not folded into 'all clear'", async ({ page, context }) => {
  await guestWith((fc) => { fc.captain = null; fc.viceCaptain = null; })(page, context);
  await expect(page.getByText("No captain picked yet.")).toBeVisible();
  await expect(page.getByTestId("checklist-all-clear")).not.toContainText("captain");
});

test("checklist: risk data on only 1 of 15 players does not say 'FPL flags none'", async ({ page, context }) => {
  await guestWith((fc) => {
    fc.squad.players.forEach((p: P, i: number) => { p.availability = { ...p.availability, risks: i === 0 ? [] : undefined }; });
  })(page, context);
  await expect(page.getByTestId("checklist-all-clear")).not.toContainText("suspension");
  await expect(page.getByText(/FPL risk data covers 1 of 15 players/)).toBeVisible();
});

test("subs strip: a long hyphenated name wraps at the hyphen and is not cut at 360px", async ({ page, context }) => {
  await page.addInitScript(() => { try { localStorage.setItem("fpl-pitch-view", "3d"); } catch {} });
  await guestWith((fc) => {
    const benchId = fc.upcoming[0].bench[1];
    for (const list of [fc.squad.players, ...fc.upcoming.map((u: { players: P[] }) => u.players)])
      for (const p of list) if (p.id === benchId) p.webName = "Alexander-Arnold";
  })(page, context, 360);
  const name = page.getByTestId("subs-strip").first().getByTestId("sub-name").filter({ hasText: "Alexander-Arnold" });
  await name.scrollIntoViewIfNeeded();
  const m = await name.evaluate((e) => {
    const parts = [...e.children] as HTMLElement[];
    return {
      text: e.textContent,
      words: parts.map((c) => c.textContent),
      cut: parts.map((c) => c.scrollWidth - c.clientWidth),
      tops: parts.map((c) => Math.round(c.getBoundingClientRect().top)),
      h: e.getBoundingClientRect().height,
      lh: parseFloat(getComputedStyle(e).lineHeight),
    };
  });
  expect(m.text).toBe("Alexander-Arnold");
  expect(m.words, "split only after the hyphen").toEqual(["Alexander-", "Arnold"]);
  expect(m.cut.every((c) => c <= 1), "no word is cut").toBe(true);
  expect(m.tops[1], "line 1 ends with 'Alexander-'").toBeGreaterThan(m.tops[0]);
  expect(m.h).toBeLessThanOrEqual(2 * m.lh + 1);
});

/** The pane on screen (the others are off to the side with no height) and where its content ends. */
const activePane = (page: Page) =>
  page.evaluate(() => {
    const panes = [...document.querySelectorAll(".tab-swipe > div")] as HTMLElement[];
    const on = panes.find((p) => p.getBoundingClientRect().left > -5 && p.getBoundingClientRect().left < innerWidth - 5)!;
    return { doc: document.documentElement.scrollHeight, bottom: on.getBoundingClientRect().bottom + window.scrollY, others: panes.filter((p) => p !== on).map((p) => p.getBoundingClientRect().height) };
  });

for (const tab of ["leagues", "live", "squad"]) {
  test(`the page scrolls only as far as the ${tab} tab (no empty panes below it)`, async ({ page }) => {
    await openSquad(page, `/?tab=${tab}`).catch(() => page.waitForTimeout(1500));
    await page.waitForTimeout(800);
    const m = await activePane(page);
    // a short tab fills the screen (the page is at least one screen tall); a long one has only the footer below it
    const vh = page.viewportSize()!.height;
    expect(m.doc, "no empty panes below the open tab").toBeLessThanOrEqual(Math.max(m.bottom + 220, vh + 120));
    expect(m.others.every((h) => h === 0), "other panes take no height").toBe(true);
  });
}

test("switching from deep in Squad to another tab starts at the top of that tab", async ({ page }) => {
  await openSquad(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1200);
  await page.getByRole("tab", { name: /^Scenarios$/ }).click();
  await page.waitForTimeout(900);
  const y = await page.evaluate(() => window.scrollY);
  expect(y, "near the top of the new tab, not at its bottom").toBeLessThan(450);
  await expect(page.getByRole("tab", { name: /^Scenarios$/ })).toHaveAttribute("aria-selected", "true");
});

test("panes that are not open cannot be focused or tabbed into", async ({ page }) => {
  await openSquad(page);
  const inertPanes = await page.evaluate(() => [...document.querySelectorAll(".tab-swipe > div")].map((p) => (p as HTMLElement).inert));
  expect(inertPanes.filter(Boolean).length).toBe(inertPanes.length - 1);
  const reached = new Set<boolean>();
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => {
      const a = document.activeElement;
      return !!a && [...document.querySelectorAll(".tab-swipe > div")].some((p) => (p as HTMLElement).inert && p.contains(a));
    }));
  }
  expect(reached.has(true), "focus never enters a hidden pane").toBe(false);
});

const swapCaptain = (which: "captainId" | "viceCaptainId") => async (page: Page, context: import("@playwright/test").BrowserContext) => {
  const fc = latestForecast();
  const leaver = fc.squad.players.find((p: { id: number }) => p.id === fc.upcoming[0][which]);
  const inSquad = new Set(fc.squad.players.map((p: { id: number }) => p.id));
  const joiner = fc.pool.find((p: { id: number; position: string }) => !inSquad.has(p.id) && p.position === leaver.position);
  const live = fc.squad.players.map((p: { id: number; position: string }) => ({ id: p.id === leaver.id ? joiner.id : p.id, position: p.position }));
  await page.clock.install({ time: Date.parse(fc.deadlineTime) - 5 * 3_600_000 });
  await context.clearCookies();
  await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...fc, teamName: "Guest FC" }) }));
  await page.route("**/api/live*", (route) =>
    route.request().url().includes("squad=1")
      ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ gameweek: fc.basedOnGameweek + 1, chip: null, squad: live }) })
      : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.goto("/?team=999111&tab=squad");
  await page.getByTestId("squad-sync-banner").waitFor();
  return leaver.webName as string;
};

test("checklist: when a transfer sells the captain the row follows the pitch's armband and is not 'all clear'", async ({ page, context }) => {
  const sold = await swapCaptain("captainId")(page, context);
  const pick = (await page.getByTestId("captain-shortlist").locator("li").first().locator("span.truncate").innerText()).split(/\s/)[0]; // the shortlist's top pick wears the armband
  const row = page.locator("div.flex.items-start", { has: page.getByText("Captain", { exact: true }) });
  await expect(row).toContainText("moved the armband");
  await expect(row).toContainText(pick);
  await expect(row).not.toContainText(`${sold},`);
  await expect(page.getByTestId("checklist-all-clear")).not.toContainText("captain");
});

test("checklist: when only the vice changes the captain row says vice adjusted, not that the armband moved", async ({ page, context }) => {
  await swapCaptain("viceCaptainId")(page, context);
  await expect(page.getByTestId("checklist-all-clear")).toContainText("vice adjusted");
  await expect(page.getByText(/moved the armband/)).toHaveCount(0);
});

test("Scenarios: a guest's pinned re-solve sends the guest's own squad, and the owner's does not", async ({ page, context }) => {
  const fc = latestForecast();
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/solve*", async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "stub" }) });
  });
  const pinAndSolve = async () => {
    await page.getByRole("button", { name: /Pin players/ }).first().click();
    await page.locator("#force-lock-body button").first().click();
    await page.getByRole("button", { name: /Solve with 1 pin/ }).click();
    await expect.poll(() => bodies.length).toBeGreaterThan(0);
  };

  await context.clearCookies();
  await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...fc, teamName: "Guest FC" }) }));
  await page.goto("/?team=999444&tab=scenarios");
  await pinAndSolve();
  const team = bodies[0].team as { squad: { id: number; sellPrice: number }[]; bank: number; freeTransfers: number };
  expect(team.squad.map((p) => p.id)).toEqual(fc.squad.players.map((p: { id: number }) => p.id));
  expect(team.bank).toBe(fc.squad.bank);
  expect(team.freeTransfers).toBe(fc.scenarios.freeTransfers.value);

  bodies.length = 0;
  await context.clearCookies();
  await page.unroute("**/api/forecast*");
  await page.goto("/?tab=scenarios");
  await pinAndSolve();
  expect(bodies[0].team).toBeUndefined();
});
