import { test, expect, type Locator, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* Smoke tests for the screens that have broken before. They use the app's own
 * team (the cookie below) and replay recorded /api/live payloads, so nothing
 * here reaches FPL. */

const OWNER = "1168513";
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

let pageErrors: string[] = [];

test.beforeEach(async ({ context, page }) => {
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await context.addCookies([{ name: "fpl_team_id", value: OWNER, url: "http://localhost:3123" }]);
  // headshots come from FPL's site: serve a stand-in so photos mode has images
  await page.route("**/resources.premierleague.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 140"><circle cx="55" cy="52" r="26" fill="#e8b98f"/></svg>`,
    }),
  );
});

test.afterEach(() => {
  expect(pageErrors, "no uncaught page errors").toEqual([]);
});

/** Replays /api/live from a fixture; `poll.current` can be switched mid-test. */
async function mockLive(page: Page, poll: { current: "a" | "b" }) {
  await page.route("**/api/live*", (route) =>
    route.fulfill({ contentType: "application/json", body: fixture(`live-${poll.current}.json`) }),
  );
}

/** Opens the app and waits for the Live tab's pitch (it appears after the first poll). */
async function open(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Van Dijk,/ }).waitFor();
}

async function openTab(page: Page, name: "Live" | "Squad" | "Scenarios") {
  await page.getByRole("button", { name: new RegExp(`^${name}$`) }).first().click();
  await page.waitForTimeout(700); // the tab pane slides in
}

/** The pitch scene currently on screen (the tabs keep all three mounted). */
async function visibleScene(page: Page): Promise<Locator> {
  const scenes = page.locator(".floodlit-pitch");
  const width = page.viewportSize()!.width;
  const count = await scenes.count();
  for (let i = 0; i < count; i++) {
    const box = await scenes.nth(i).boundingBox();
    if (box && box.x > -5 && box.x < width - 5) return scenes.nth(i);
  }
  throw new Error("no pitch is on screen");
}

/** How many tokens share each line of a pitch. */
async function rowSizes(scene: Locator, selector: string): Promise<number[]> {
  const tops = await scene.locator(selector).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  const rows = new Map<number, number>();
  for (const t of tops) rows.set(t, (rows.get(t) ?? 0) + 1);
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
}

test.describe("Live tab", () => {
  test("shows the eleven in formation, with live and finished players marked", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    const scene = await visibleScene(page);
    expect(await rowSizes(scene, "button[data-flip]")).toEqual([1, 4, 5, 1]); // 4-5-1, the five-man midfield on one row
    await expect(page.getByRole("button", { name: /^Van Dijk.*Playing/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Palmer.*Full time/ })).toBeVisible(); // provisionally finished counts as full time
    await expect(page.getByRole("button", { name: /^Porro.*Kicks off/ })).toBeVisible();
    await expect(scene.locator(".live-glow-shirt")).not.toHaveCount(0);
  });

  test("lists what is still to come and who is due bonus", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    const strip = page.getByText("Still to come").locator("..");
    await expect(strip).toContainText("Playing now");
    await expect(strip).toContainText("Sun 23:30");
    await expect(strip).toContainText("Bonus due");
    await expect(strip).toContainText("Palmer");
  });

  test("a new poll adds an entry to the what-just-happened feed", async ({ page }) => {
    const poll = { current: "a" as "a" | "b" };
    await mockLive(page, poll);
    await open(page);
    await expect(page.getByText("show up here as they happen")).toBeVisible();
    poll.current = "b";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const feed = page.getByText("What just happened").locator("..");
    await expect(feed).toContainText("Palmer");
    await expect(feed).toContainText("scored");
    await expect(feed).toContainText("+5");
  });

  test("opening a player shows the points breakdown with counts", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    await page.getByRole("button", { name: /^Palmer/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Assists");
    await expect(dialog).toContainText("×2"); // two assists, shown as a count
    await expect(dialog).toContainText("bonus not added yet");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("Squad and Scenarios tabs", () => {
  for (const width of [320, 360, 390]) {
    test(`the squad pitch fits ${width}px wide with the midfield on one row`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockLive(page, { current: "a" });
      await open(page);
      await openTab(page, "Squad");
      const scene = await visibleScene(page);
      const rows = await rowSizes(scene, "button[data-flip]");
      expect(rows.length).toBeLessThanOrEqual(4);
      expect(rows.reduce((a, b) => a + b, 0)).toBe(11);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "no sideways scrolling").toBeLessThanOrEqual(1);
    });
  }

  test("the Photos / Shirts switch changes the faces and is remembered", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    await openTab(page, "Squad");
    const scene = await visibleScene(page);
    const group = page.getByRole("group", { name: "Player faces" }).nth(1);
    await group.getByRole("button", { name: "Photos" }).click();
    await expect(scene.locator("img")).not.toHaveCount(0);
    await group.getByRole("button", { name: "Shirts" }).click();
    await expect(scene.locator("img")).toHaveCount(0);
    await page.reload();
    await page.locator(".floodlit-pitch").first().waitFor();
    expect(await page.evaluate(() => localStorage.getItem("fpl-face-mode"))).toBe("shirt");
  });

  test("tapping a player opens the xP breakdown and Escape returns focus", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    await openTab(page, "Squad");
    const scene = await visibleScene(page);
    const token = scene.locator("button[data-flip]").first();
    await token.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("xP");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(token).toBeFocused();
  });

  test("the scenarios pitch shows a full eleven", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    await openTab(page, "Scenarios");
    const scene = await visibleScene(page);
    await expect(scene.locator("[data-flip]")).toHaveCount(11);
  });
});

test.describe("Replace a player on the pitch", () => {
  test("lists legal options, confirms, and saves through the transfers route", async ({ page }) => {
    let posted: { outId: number; inId: number; basedOnGw: number } | null = null;
    await page.route("**/api/transfers", async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fulfill({ contentType: "application/json", body: "{}" });
      posted = JSON.parse(req.postData() ?? "{}");
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          rebuild: "started",
          overrides: { basedOnGw: posted!.basedOnGw, transfers: [{ out: posted!.outId, in: posted!.inId }] },
        }),
      });
    });
    await mockLive(page, { current: "a" });
    await open(page);
    await openTab(page, "Squad");
    const scene = await visibleScene(page);
    await scene.locator("button[data-flip]").first().click();
    await page.getByRole("button", { name: /^Replace / }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Replace");
    const options = dialog.locator("li button");
    expect(await options.count()).toBeGreaterThan(0);

    await options.first().click();
    await expect(dialog).toContainText("left");
    await dialog.getByRole("button", { name: "Save transfer" }).click();
    await expect(dialog.getByRole("status")).toContainText("Saved");
    expect(posted).not.toBeNull();
    expect(posted!.outId).not.toBe(posted!.inId);

    await page.keyboard.press("Escape");
    // the saved swap now marks the outgoing shirt, and the deadline banner counts it
    await expect(scene.locator("span[title^='Saved transfer']")).toHaveCount(1);
    await expect(page.getByText(/transfers? pending/).first()).toBeVisible();
  });
});

function latestDeadline(): string {
  const dir = join(__dirname, "..", "..", "data", "forecast");
  const newest = readdirSync(dir)
    .filter((f) => /^gw\d+\.json$/.test(f))
    .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))[0];
  return JSON.parse(readFileSync(join(dir, newest), "utf8")).deadlineTime;
}

test.describe("Deadline banner", () => {
  test("counts down before the deadline and is gone after it", async ({ page, context }) => {
    const deadline = Date.parse(latestDeadline());
    await page.clock.install({ time: deadline - 5 * 3_600_000 });
    await mockLive(page, { current: "a" });
    await page.goto("/");
    const banner = page.getByRole("status").filter({ hasText: /deadline/i });
    await expect(banner).toContainText("Deadline today");
    await expect(banner).toContainText("SGT");
    await expect(banner).toContainText("4h");

    const later = await context.newPage();
    await later.clock.install({ time: deadline + 3_600_000 });
    await later.route("**/api/live*", (route) => route.fulfill({ contentType: "application/json", body: fixture("live-a.json") }));
    await later.goto("/");
    await later.locator(".floodlit-pitch").first().waitFor();
    await expect(later.getByRole("status").filter({ hasText: /deadline/i })).toHaveCount(0);
  });
});

test("the app can be added to a home screen", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src);
    expect(res.ok(), icon.src).toBeTruthy();
  }
});

test.describe("Rivalry duel", () => {
  const squadFor = (entryId: number, ids: number[], pts: number) => {
    const pos = ["GKP", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"] as const;
    return {
      entryId,
      entryName: `Team ${entryId}`,
      managerName: null,
      gameweek: 7,
      totalPoints: pts * 11,
      totalXp: pts * 11 + 20,
      chip: null,
      rows: ids.map((id, i) => ({
        id,
        webName: `P${id}`,
        team: "ARS",
        code: null,
        position: pos[i],
        isBench: false,
        isCaptain: i === 0,
        isViceCaptain: false,
        isArmband: i === 0,
        status: i < 6 ? "finished" : "notStarted",
        minutes: i < 6 ? 90 : 0,
        pointsSoFar: i < 6 ? pts : 0,
        remainingXp: i < 6 ? 0 : 4,
        noBakedXp: false,
        subbedIn: false,
        subbedOut: false,
        opponent: "bha (H)",
      })),
    };
  };

  test("picks a mate, shows odds and marks differentials", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await page.route(/\/api\/league(\?|$)/, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          gameweek: 7,
          leagues: [{ leagueId: 1, leagueName: "Mates" }],
          league: {
            leagueId: 1,
            leagueName: "Mates",
            myEntryId: 100,
            myRank: 1,
            totalEntries: 2,
            totalEntriesIsFloor: false,
            appendedEntryId: null,
            entries: [
              { entryId: 100, entryName: "Me FC", playerName: "Nat", rank: 1, lastRank: 1, totalPoints: 100, eventPoints: 40, projectedXp: 60, chip: null, captainName: null, playersPlayed: 6, playersLive: 0, playersToPlay: 5 },
              { entryId: 200, entryName: "Sam FC", playerName: "Sam", rank: 2, lastRank: 2, totalPoints: 90, eventPoints: 30, projectedXp: 55, chip: null, captainName: null, playersPlayed: 6, playersLive: 0, playersToPlay: 5 },
            ],
          },
        }),
      }),
    );
    await page.route("**/api/league/squad*", (route) => {
      const id = Number(new URL(route.request().url()).searchParams.get("entryId"));
      const body = id === 100 ? squadFor(100, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 5) : squadFor(200, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99], 3);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await open(page);
    await page.getByRole("button", { name: /^Leagues$/ }).first().click();
    await page.getByRole("button", { name: /Sam FC/ }).click();
    await page.getByRole("button", { name: /Duel/ }).click();
    const odds = page.getByTestId("duel-odds");
    await expect(odds).toContainText("%");
    await expect(page.getByTestId("duel")).toContainText("Only you own");
    await expect(page.getByTitle(/Differential/).first()).toBeVisible();
  });
});
