import { test, expect, type Locator, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* Smoke tests for the screens that have broken before. They use the app's own
 * team (the cookie below) and replay recorded /api/live payloads, so nothing
 * here reaches FPL. */

const OWNER = "1168513";
const ORIGIN = `http://localhost:${process.env.PW_PORT ?? 3123}`;
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

let pageErrors: string[] = [];

test.beforeEach(async ({ context, page }) => {
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await context.addCookies([{ name: "fpl_team_id", value: OWNER, url: ORIGIN }]);
  // the Squad pitch opens in 3D by default; most tests below drive the flat 2D tokens
  await page.addInitScript(() => {
    try { if (!localStorage.getItem("fpl-pitch-view")) localStorage.setItem("fpl-pitch-view", "2d"); } catch {}
  });
  // a recap with a week picker, so the Live tab always has its scrolling chip row;
  // unmocked, CI would reach FPL's real API and tests would depend on its data
  await page.route("**/api/recap*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        recap: {
          gameweek: 6, points: 56, hit: 0, averageScore: 58, rank: 90000, rankBefore: 120000,
          captain: { name: "Saka", raw: 2, multiplier: 2 },
          best: { name: "Verbruggen", points: 9, code: null, team: "BHA" },
          worst: { name: "Hall", points: 0 }, benchPoints: 11, chip: null, achievements: [], regrets: [],
        },
        gameweeks: [1, 2, 3, 4, 5, 6],
      }),
    }),
  );
  // live data comes from FPL's real API, which CI can reach: serve "no data" unless a test mocks it, so the
  // Squad tab never depends on what the real squad happens to be today
  await page.route("**/api/live*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "no live data in tests" }) }),
  );
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

/** The committed forecast's squad and pool, read from disk, so the test follows whatever build is checked in. */
function forecastSquad() {
  const dir = join(__dirname, "..", "..", "data", "forecast");
  const latest = readdirSync(dir)
    .map((f) => /^gw(\d+)\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(b[1]) - Number(a[1]))[0][0];
  const f = JSON.parse(readFileSync(join(dir, latest), "utf8"));
  const byId = new Map<number, { id: number; webName: string; position: string }>(f.pool.map((p: { id: number; webName: string; position: string }) => [p.id, p]));
  return { basedOn: f.basedOnGameweek as number, squad: f.squad.players as { id: number; webName: string; position: string }[], pool: [...byId.values()], startingXi: f.upcoming[0].startingXi as number[] };
}


/** Replays /api/live from a fixture; `poll.current` can be switched mid-test. */
async function mockLive(page: Page, poll: { current: "a" | "b" }) {
  await page.route("**/api/live*", (route) => {
    // The Squad tab also asks for the live squad (squad=1). The fixture is some other team, so say "no change":
    // the Squad pitch is then the forecast as built, which is what the tests that use this helper expect.
    if (route.request().url().includes("squad=1")) {
      const { squad, basedOn } = forecastSquad();
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ gameweek: basedOn + 1, chip: null, squad: squad.map((p) => ({ id: p.id, position: p.position })) }) });
    }
    return route.fulfill({ contentType: "application/json", body: fixture(`live-${poll.current}.json`) });
  });
}

/** The 3D pitch on the Squad tab. The Live tab's pitch is also in the page (off to the side), so
 * "the first pitch" is not reliable once live data arrives. */
const squadPitch3d = (page: Page) =>
  page.locator(".panel", { has: page.getByText(/MODEL · GW/) }).first().getByTestId("pitch3d");

/** Opens the app and waits for the Live tab's pitch (it appears after the first poll). */
async function open(page: Page) {
  await page.goto("/?tab=live"); // the app opens on Squad before the deadline; most tests start on Live
  await page.getByRole("button", { name: /^Van Dijk,/ }).waitFor();
}

/** Opens the team bar's overflow menu and taps one item ("Copy link" or "Change team"). */
async function openTeamMenu(page: Page, item: "Copy link" | "Change team") {
  await page.getByRole("button", { name: "Team options" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** The recap folds to a bar while matches are live: tap it open if it is closed. */
async function openRecap(page: Page) {
  const bar = page.getByTestId("recap").getByRole("button", { name: /recap/i }).first();
  await bar.waitFor();
  if ((await bar.getAttribute("aria-expanded")) === "false") await bar.click();
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
    const strip = page.getByTestId("rank-threats");
    await expect(strip).toContainText("Playing now");
    await expect(strip).toContainText("Sun 23:30");
    await expect(strip).toContainText("Bonus due");
    await expect(strip).toContainText("Palmer");
  });

  test("a new poll adds an entry to the what-just-happened feed", async ({ page }) => {
    const poll = { current: "a" as "a" | "b" };
    await mockLive(page, poll);
    await open(page);
    await expect(page.getByText("appear here live while this page is open")).toBeVisible();
    poll.current = "b";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const feed = page.getByText("What just happened").locator("..");
    await expect(feed).toContainText("Palmer");
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
    await expect(page.getByTestId("deadline-banner")).toContainText("1 pending");

    // and the pitch previews the incoming player in their place, still eleven on the pitch
    await expect(page.getByTestId("preview-banner")).toContainText("1 saved transfer");
    await expect(scene.locator("[data-flip]")).toHaveCount(11);
    await scene.locator("button[data-flip]", { has: page.locator("span[title^='Saved transfer']") }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Saved transfer · preview");
    await sheet.getByRole("button", { name: /^Undo / }).click();
    await expect(page.getByTestId("preview-banner")).toHaveCount(0);
  });
});

test.describe("Rebuild now", () => {
  test("starts a rebuild and says so", async ({ page }) => {
    await page.route("**/api/rebuild", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rebuild: "started" }) }),
    );
    await mockLive(page, { current: "a" });
    await open(page);
    await openTab(page, "Squad");
    const box = page.getByTestId("rebuild").first();
    // it is the first thing on the Squad tab, not buried under the pitch
    const scene = await visibleScene(page);
    expect((await box.boundingBox())!.y).toBeLessThan((await scene.boundingBox())!.y);
    await box.getByRole("button", { name: "Rebuild now" }).click();
    await expect(box).toContainText("Rebuilding the forecast now");
    await expect(box.getByRole("button")).toBeDisabled(); // a short cool-down, so it can't be mashed
  });

  test("explains why when GitHub won't start one", async ({ page }) => {
    await page.route("**/api/rebuild", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, rebuild: "scheduled", hint: "The app's GitHub token can't start rebuilds." }),
      }),
    );
    await mockLive(page, { current: "a" });
    await open(page);
    await openTab(page, "Squad");
    const box = page.getByTestId("rebuild").first();
    await box.getByRole("button", { name: "Rebuild now" }).click();
    await expect(box).toContainText("next daily rebuild");
    await expect(box).toContainText("token can't start rebuilds");
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
    const banner = page.getByTestId("deadline-banner");
    await expect(banner).toHaveAttribute("data-tone", "today");
    await expect(banner).toContainText("deadline");
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

test.describe("Gameweek recap", () => {
  test("shows the card, badges and the regret machine", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await page.route("**/api/recap*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          recap: {
            gameweek: 6,
            points: 71,
            hit: 4,
            averageScore: 48,
            rank: 90000,
            rankBefore: 120000,
            captain: { name: "Haaland", raw: 4, multiplier: 2 },
            best: { name: "Palmer", points: 14 },
            worst: { name: "Gabriel", points: 1 },
            benchPoints: 12,
            chip: null,
            achievements: [
              { id: "bench-regret", emoji: "🪑", title: "Bench regret", detail: "12 points rotted on your bench", good: false },
            ],
            regrets: [{ id: "captain", text: "If you'd captained Palmer instead of Haaland", points: 20 }],
          },
        }),
      }),
    );
    await open(page);
    const card = page.getByTestId("recap");
    await expect(card).toContainText("GW6 recap");
    await openRecap(page);
    await expect(card).toContainText("30,000 places");
    await expect(page.getByTestId("achievements")).toContainText("Bench regret");
    await card.getByRole("button", { name: /Regret machine/ }).click();
    await expect(page.getByTestId("regrets")).toContainText("+20");
  });
  test("sharing sends a caption and the link, not the card's own numbers", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await page.route("**/api/recap*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          recap: {
            gameweek: 6, points: 71, hit: 0, averageScore: 48, rank: 90000, rankBefore: 120000,
            captain: { name: "Haaland", raw: 9, multiplier: 2 },
            best: { name: "Palmer", points: 14, code: null, team: "CHE" },
            worst: { name: "Gabriel", points: 1 }, benchPoints: 3, chip: null,
            achievements: [], regrets: [],
          },
        }),
      }),
    );
    await page.addInitScript(() => {
      (navigator as unknown as { canShare: () => boolean }).canShare = () => true;
      (navigator as unknown as { share: (d: { text?: string }) => Promise<void> }).share = async (d) => {
        (window as unknown as { __shared: string }).__shared = d.text ?? "";
      };
    });
    await open(page);
    await openRecap(page);
    await page.getByTestId("recap").getByRole("button", { name: "Share this card" }).click();
    await page.waitForFunction(() => (window as unknown as { __shared?: string }).__shared);
    const shared = await page.evaluate(() => (window as unknown as { __shared: string }).__shared);
    expect(shared).toContain(`${ORIGIN}/`);
    expect(shared).not.toMatch(/71|Haaland|Palmer/);
  });
  test("a week picker switches the card to an earlier gameweek", async ({ page }) => {
    await mockLive(page, { current: "a" });
    const recapFor = (gw: number, points: number) => ({
      gameweek: gw, points, hit: 0, averageScore: 50, rank: 100000, rankBefore: 120000,
      captain: { name: "Haaland", raw: 6, multiplier: 2 },
      best: { name: "Palmer", points: 10, code: null, team: "CHE" },
      worst: { name: "Gabriel", points: 1 }, benchPoints: 3, chip: null, achievements: [], regrets: [],
    });
    const asked: string[] = [];
    await page.route("**/api/recap*", (route) => {
      const gw = new URL(route.request().url()).searchParams.get("gw");
      asked.push(gw ?? "latest");
      const n = gw ? Number(gw) : 6;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ recap: recapFor(n, 40 + n), gameweeks: [1, 2, 3, 4, 5, 6] }),
      });
    });
    await open(page);
    const card = page.getByTestId("recap");
    await expect(card).toContainText("GW6 recap");
    await openRecap(page);
    await card.getByRole("button", { name: "GW3", exact: true }).click();
    await expect(card).toContainText("GW3 recap");
    await expect(card.getByRole("button", { name: "GW3", exact: true })).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: "GW6", exact: true }).click();
    await expect(card).toContainText("GW6 recap");
    expect(asked).toEqual(["latest", "3"]); // going back to a week already seen is not refetched
  });
});

test.describe("Recap card look", () => {
  test("folds to a bar while matches are live, opens on tap, and previews the share image", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    const bar = page.getByTestId("recap").getByRole("button", { name: /GW6 recap/ });
    await expect(bar).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("recap-image")).toHaveCount(0);
    await bar.click();
    const img = page.getByTestId("recap-image");
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("alt", /GW6 recap card: 56 points/);
    await bar.click();
    await expect(page.getByTestId("recap-image")).toHaveCount(0);
  });

  test("the share image has the brand footer and grows with the regret strip", async ({ page }) => {
    const sizes: Record<string, { w: number; h: number; brandGreen: boolean }> = {};
    for (const withRegret of [false, true]) {
      await page.unroute("**/api/recap*");
      await page.route("**/api/recap*", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            recap: {
              gameweek: 6, points: 56, hit: 0, averageScore: 58, rank: 90000, rankBefore: 120000,
              captain: { name: "Saka", raw: 2, multiplier: 2 },
              best: { name: "Verbruggen", points: 9, code: null, team: "BHA" },
              worst: { name: "Hall", points: 0 }, benchPoints: 3, chip: null, achievements: [],
              regrets: withRegret ? [{ id: "captain", text: "If you'd captained Verbruggen instead of Saka", points: 14 }] : [],
            },
            gameweeks: [5, 6],
          }),
        }),
      );
      await mockLive(page, { current: "a" });
      await open(page);
      await openRecap(page);
      const img = page.getByTestId("recap-image");
      await expect(img).toBeVisible();
      sizes[String(withRegret)] = await img.evaluate(async (el) => {
        const i = el as HTMLImageElement;
        await i.decode();
        const c = document.createElement("canvas");
        c.width = i.naturalWidth;
        c.height = i.naturalHeight;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(i, 0, 0);
        // the brand mark is #3ddc84 green: look for it in the bottom 220px
        const data = ctx.getImageData(0, c.height - 220, c.width, 220).data;
        let brandGreen = false;
        for (let p = 0; p < data.length; p += 4) {
          if (Math.abs(data[p] - 0x3d) < 12 && Math.abs(data[p + 1] - 0xdc) < 12 && Math.abs(data[p + 2] - 0x84) < 12) {
            brandGreen = true;
            break;
          }
        }
        return { w: c.width, h: c.height, brandGreen };
      });
    }
    expect(sizes.false.w).toBe(800);
    expect(sizes.false.brandGreen).toBe(true);
    expect(sizes.true.brandGreen).toBe(true);
    expect(sizes.true.h - sizes.false.h).toBeGreaterThan(100); // the regret strip adds height
    expect(sizes.true.h - sizes.false.h).toBeLessThan(220);
  });
});

test.describe("Team bar", () => {
  test("is one tidy row until you ask to change team", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    const bar = page.getByTestId("team-bar");
    await expect(bar).toContainText("Viewing");
    await expect(bar.getByRole("textbox")).toHaveCount(0);
    expect((await bar.boundingBox())!.height).toBeLessThan(40); // one text line; the buttons live in the header menu
    await openTeamMenu(page, "Change team");
    await expect(bar.getByRole("textbox", { name: "Team ID" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "View" })).toBeDisabled(); // nothing typed yet
    await bar.getByRole("textbox", { name: "Team ID" }).fill("12");
    await expect(bar.getByRole("button", { name: "View" })).toBeEnabled();
  });
});


test.describe("Team bar overflow menu", () => {
  test("opens with Copy link and Change team, Escape closes it and returns focus to the button", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    const bar = page.getByRole("banner");
    const trigger = bar.getByRole("button", { name: "Team options" });
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await trigger.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const items = page.getByRole("menuitem");
    await expect(items).toHaveText(["Copy link", "Change team"]);
    for (const box of await items.all()) expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(items.first()).toBeFocused(); // keyboard lands inside the menu
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });

  test("tapping outside closes it", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    await page.getByRole("button", { name: "Team options" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.mouse.click(5, 400);
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("Copy link copies the share link and says so; Change team opens the team field", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
    await page.addInitScript(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
    await mockLive(page, { current: "a" });
    await open(page);
    await openTeamMenu(page, "Copy link");
    await expect(page.getByText("Link copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ORIGIN}/?team=${OWNER}`);
    await openTeamMenu(page, "Change team");
    await expect(page.getByTestId("team-bar").getByRole("textbox", { name: "Team ID" })).toBeFocused();
  });

  test("a guest can still switch team from the menu", async ({ page, context }) => {
    await context.clearCookies();
    await page.route("**/api/forecast*", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...guestForecast(), teamName: new URL(route.request().url()).searchParams.get("teamId") === "535353" ? "Second FC" : "Guest FC" }) }),
    );
    await page.goto("/");
    await page.getByRole("textbox", { name: "FPL team ID" }).fill("424242");
    await page.getByRole("button", { name: "View squad" }).click();
    const bar = page.getByTestId("team-bar");
    await expect(bar).toContainText("Guest FC");
    await openTeamMenu(page, "Change team");
    await bar.getByRole("textbox", { name: "Team ID" }).fill("535353");
    await bar.getByRole("button", { name: "View", exact: true }).click();
    await expect(bar).toContainText("Second FC");
  });
});

test.describe("Chrome height", () => {
  for (const width of [360, 390]) {
    test(`the deadline banner is one line at ${width}px, even with a pending transfer`, async ({ page }) => {
      await page.clock.install({ time: Date.parse(latestDeadline()) - 30 * 3_600_000 });
      await page.setViewportSize({ width, height: 844 });
      await mockLive(page, { current: "a" });
      await page.goto("/?tab=live");
      const banner = page.getByTestId("deadline-banner");
      await expect(banner).toContainText("SGT");
      const box = (await banner.boundingBox())!;
      expect(box.height).toBeLessThan(40); // one text line plus padding, never wrapped
      expect((await page.getByRole("banner").boundingBox())!.height).toBeLessThan(66); // the menu button does not grow the header
      expect((await page.getByTestId("team-bar").boundingBox())!.height).toBeLessThan(40);
      await expect(banner).not.toContainText(/\bC\s+\w/); // the captain is on the pitch and in the checklist
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/chrome-${width}.png`, clip: { x: 0, y: 0, width, height: 360 } });
    });
  }
});

test.describe("Match day", () => {
  test("bench cover says who comes on if a starter doesn't play", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    const cover = page.getByTestId("bench-cover");
    await expect(cover).toBeVisible();
    await expect(cover).toContainText("Bench cover");
    await cover.locator("summary").click();
    await expect(cover.locator("li").first()).toBeVisible();
  });

  test("the what-just-happened feed survives a refresh", async ({ page }) => {
    const poll = { current: "a" as "a" | "b" };
    await mockLive(page, poll);
    await open(page);
    poll.current = "b";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const feed = page.getByText("What just happened").locator("..");
    await expect(feed).toContainText("Palmer");
    await page.reload();
    await page.getByRole("button", { name: /^Van Dijk,/ }).waitFor();
    await expect(page.getByText("What just happened").locator("..")).toContainText("Palmer");
  });

  test("says so when live data stops arriving, and recovers", async ({ page }) => {
    let down = false;
    await page.route("**/api/live*", (route) =>
      down
        ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "FPL is down" }) })
        : route.fulfill({ contentType: "application/json", body: fixture("live-a.json") }),
    );
    await open(page);
    await expect(page.getByTestId("live-stale")).toHaveCount(0);
    down = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const banner = page.getByTestId("live-stale");
    await expect(banner).toHaveAttribute("data-level", "error");
    await expect(banner).toContainText("last update");
    down = false;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByTestId("live-stale")).toHaveCount(0);
  });

  test("a failed first load shows a message and a retry, not a blank tab", async ({ page }) => {
    let down = true;
    await page.route("**/api/live*", (route) =>
      down
        ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "FPL is down" }) })
        : route.fulfill({ contentType: "application/json", body: fixture("live-a.json") }),
    );
    await page.goto("/?tab=live");
    const failed = page.getByTestId("live-failed");
    await expect(failed).toContainText("FPL is down");
    down = false;
    await failed.getByRole("button", { name: "Retry" }).click();
    await page.getByRole("button", { name: /^Van Dijk,/ }).waitFor();
    await expect(page.getByTestId("live-failed")).toHaveCount(0);
  });

  test("while FPL is updating for a new season the tab says so, not 'something broke'", async ({ page }) => {
    await page.route("**/api/live*", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "FPL is updating for the new season", updating: true }),
      }),
    );
    await page.goto("/?tab=live");
    await expect(page.getByTestId("live-failed")).toContainText("FPL is updating for the new season");
    await expect(page.getByTestId("live-failed")).not.toContainText("Couldn't load");
  });

  test("your last duel shows on the Live tab and resumes on Leagues", async ({ page }) => {
    await mockLive(page, { current: "a" });
    const squad = (entryId: number, pts: number) => ({
      entryId, entryName: `Team ${entryId}`, managerName: null, gameweek: 7, totalPoints: pts * 6, totalXp: pts * 6 + 12, chip: null,
      rows: Array.from({ length: 11 }, (_, i) => ({
        id: entryId * 100 + i, webName: `P${i}`, team: "ARS", code: null,
        position: (["GKP", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"] as const)[i],
        isBench: false, isCaptain: i === 0, isViceCaptain: false, isArmband: i === 0,
        status: i < 6 ? "finished" : "notStarted", minutes: i < 6 ? 90 : 0, pointsSoFar: i < 6 ? pts : 0,
        remainingXp: i < 6 ? 0 : 3, noBakedXp: false, subbedIn: false, subbedOut: false, opponent: "bha (H)",
      })),
    });
    await page.route("**/api/league/squad*", (route) => {
      const id = Number(new URL(route.request().url()).searchParams.get("entryId"));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(squad(id, id === 100 ? 5 : 3)) });
    });
    await page.route(/\/api\/league(\?|$)/, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          gameweek: 7, leagues: [{ leagueId: 1, leagueName: "Mates" }],
          league: {
            leagueId: 1, leagueName: "Mates", myEntryId: 100, myRank: 1, totalEntries: 2, totalEntriesIsFloor: false, appendedEntryId: null,
            entries: [
              { entryId: 100, entryName: "Me FC", playerName: "Nat", rank: 1, lastRank: 1, totalPoints: 100, eventPoints: 40, projectedXp: 60, chip: null, captainName: null, playersPlayed: 6, playersLive: 0, playersToPlay: 5 },
              { entryId: 200, entryName: "Sam FC", playerName: "Sam", rank: 2, lastRank: 2, totalPoints: 90, eventPoints: 30, projectedXp: 55, chip: null, captainName: null, playersPlayed: 6, playersLive: 0, playersToPlay: 5 },
            ],
          },
        }),
      }),
    );
    await page.addInitScript(() => {
      localStorage.setItem("gaffer-duel-rival", JSON.stringify({ myEntryId: 100, entryId: 200, name: "Sam FC" }));
    });
    await open(page);
    const mini = page.getByTestId("duel-mini");
    await expect(mini).toContainText("Sam FC");
    await expect(mini).toContainText("%");
    await mini.click();
    await page.waitForTimeout(700);
    await page.getByTestId("resume-duel").click();
    await expect(page.getByTestId("duel")).toContainText("you vs Sam FC");
  });
});

test.describe("Screens say things once", () => {
  test("the last gameweek's result lives in the recap, not also on the Squad and Live tabs", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await open(page);
    await expect(page.getByText(/GW\d+ result/)).toHaveCount(0);
    await expect(page.getByText(/GW\d+ final/)).toHaveCount(0);
    await expect(page.getByTestId("recap")).toContainText("GW6 recap");
    await openTab(page, "Squad");
    await expect(page.getByText(/GW\d+ result/)).toHaveCount(0);
  });

  test("chips are listed once on the Squad tab, in the deadline checklist", async ({ page }) => {
    await page.clock.install({ time: Date.parse(latestDeadline()) - 5 * 3_600_000 });
    await mockLive(page, { current: "a" });
    await open(page);
    await openTab(page, "Squad");
    // scoped to the checklist panel: page-wide text (team bar, manager names) varies by environment
    const checklist = page.locator(".panel").filter({ has: page.getByRole("heading", { name: /this week.s decisions/i }) });
    await expect(checklist.getByText("Chips", { exact: true })).toHaveCount(1);
    // the owner at GW11: wildcard and Bench Boost are spent until GW20, no manager chip
    await expect(checklist.getByText(/chips? left \(Free Hit, Triple Captain\); use by GW19 \(9 GWs incl\. this one\)/)).toBeVisible();
    await expect(checklist.getByText(/Wildcard, Bench Boost used, next from GW20/)).toBeVisible();
    await expect(checklist.getByText(/manager chip/i)).toHaveCount(0);
  });

  test("a guest's chips come from their own forecast, not the owner's", async ({ page, context }) => {
    await context.clearCookies();
    const forecast = JSON.parse(readFileSync(join(__dirname, "..", "..", "data", "forecast", "gw11.json"), "utf8"));
    forecast.chips = forecast.chips.map((c: { name: string; window: { start: number } }) =>
      c.name === "bboost" && c.window.start === 1 ? { ...c, used: false, availableNow: true } : c);
    forecast.teamName = "Guest FC";
    await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(forecast) }));
    await page.clock.install({ time: Date.parse(latestDeadline()) - 5 * 3_600_000 });
    await mockLive(page, { current: "a" });
    await page.goto("/?team=999111");
    await expect(page.getByText("Guest FC").first()).toBeVisible();
    const checklist = page.locator(".panel").filter({ has: page.getByRole("heading", { name: /this week.s decisions/i }) });
    await expect(checklist.getByText(/3 first-half chips left \(Free Hit, Bench Boost, Triple Captain\)/)).toBeVisible();
  });
});

test.describe("Suspension / loan-ban risk", () => {
  // Guest path: a ?team= link for a team that is not the saved one is served by
  // /api/forecast. Mock that with the committed forecast plus FPL-style risks.
  test("the deadline checklist quotes FPL's risk wording for a guest team", async ({ page }) => {
    const dir = join(__dirname, "..", "..", "data", "forecast");
    const newest = readdirSync(dir).filter((f) => /^gw\d+\.json$/.test(f)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))[0];
    const fc = JSON.parse(readFileSync(join(dir, newest), "utf8"));
    const note = "This player currently has 4 Premier League yellow cards and will face a 1-match suspension on receiving their next.";
    fc.squad.players[0].availability = { ...fc.squad.players[0].availability, risks: [{ kind: "suspension_risk", gameweek: null, notes: note }] };
    const name = fc.squad.players[0].webName;
    await page.clock.install({ time: Date.parse(fc.deadlineTime) - 5 * 3_600_000 });
    await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fc) }));
    await mockLive(page, { current: "a" });
    await page.goto("/?team=999999&tab=squad");
    const row = page.getByText("Suspension / loan-ban risk (FPL)");
    await expect(row).toBeVisible();
    await expect(page.getByText(`${name}: ${note}`)).toBeVisible();
  });

  test("a forecast built before the risk field existed does not say 'no risk'", async ({ page }) => {
    // Strip `risks` from the newest committed forecast (the nightly build now carries it) so this
    // keeps testing the old shape: the row must not claim FPL flags none.
    const dir = join(__dirname, "..", "..", "data", "forecast");
    const newest = readdirSync(dir).filter((f) => /^gw\d+\.json$/.test(f)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))[0];
    const fc = JSON.parse(readFileSync(join(dir, newest), "utf8"));
    for (const p of fc.squad.players) if (p.availability) delete p.availability.risks;
    await page.clock.install({ time: Date.parse(fc.deadlineTime) - 5 * 3_600_000 });
    await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fc) }));
    await mockLive(page, { current: "a" });
    await page.goto("/?team=999999&tab=squad");
    await expect(page.getByText("Suspension / loan-ban risk (FPL)")).toBeVisible();
    const riskBox = page.locator("div.flex.items-start", { has: page.getByText("Suspension / loan-ban risk (FPL)", { exact: true }) });
    await expect(riskBox).toContainText("Not in this build yet");
    await expect(page.getByText(/FPL flags no suspension or loan-ban risk/)).toHaveCount(0);
  });

  test("the row says FPL flags none when the forecast carries an empty risk list", async ({ page }) => {
    const dir = join(__dirname, "..", "..", "data", "forecast");
    const newest = readdirSync(dir).filter((f) => /^gw\d+\.json$/.test(f)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))[0];
    const fc = JSON.parse(readFileSync(join(dir, newest), "utf8"));
    for (const p of fc.squad.players) p.availability = { ...p.availability, risks: [] };
    await page.clock.install({ time: Date.parse(fc.deadlineTime) - 5 * 3_600_000 });
    await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fc) }));
    await mockLive(page, { current: "a" });
    await page.goto("/?team=999999&tab=squad");
    await expect(page.getByText(/FPL flags no suspension or loan-ban risk in your squad/)).toBeVisible();
  });
});

test.describe("Price changes (FPL)", () => {
  const newestForecast = () => {
    const dir = join(__dirname, "..", "..", "data", "forecast");
    const newest = readdirSync(dir).filter((f) => /^gw\d+\.json$/.test(f)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))[0];
    return JSON.parse(readFileSync(join(dir, newest), "utf8"));
  };
  const priceRowBox = (page: Page) =>
    page.locator("div.flex.items-start", { has: page.getByText("Price changes (FPL)", { exact: true }) });
  const quiet = { percent: 3, likelihood: 0, hourlyRate: 0, changeThisGw: 0, netTransfers: 100 };

  test("quotes FPL's price signals for a guest team", async ({ page }) => {
    const fc = newestForecast();
    for (const p of fc.squad.players) p.priceWatch = quiet;
    fc.squad.players[0].priceWatch = { ...quiet, percent: 96.5, likelihood: 4, netTransfers: 24380 };
    fc.squad.players[1].priceWatch = { ...quiet, percent: -99.3, likelihood: -5, netTransfers: -4602 };
    const [a, b] = [fc.squad.players[0].webName, fc.squad.players[1].webName];
    await page.clock.install({ time: Date.parse(fc.deadlineTime) - 5 * 3_600_000 });
    await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fc) }));
    await mockLive(page, { current: "a" });
    await page.goto("/?team=999999&tab=squad");
    await expect(page.getByText("Price changes (FPL)")).toBeVisible();
    await expect(priceRowBox(page)).toContainText(`FPL data suggests ${b} (-99.3%, -5k net transfers this GW) price may fall.`);
    await expect(priceRowBox(page)).toContainText(`FPL data suggests ${a} (+96.5%, +24k net transfers this GW) price may rise.`);
  });

  test("says none are near a change when the data is there and quiet", async ({ page }) => {
    const fc = newestForecast();
    for (const p of fc.squad.players) p.priceWatch = quiet;
    await page.clock.install({ time: Date.parse(fc.deadlineTime) - 5 * 3_600_000 });
    await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fc) }));
    await mockLive(page, { current: "a" });
    await page.goto("/?team=999999&tab=squad");
    await expect(priceRowBox(page)).toContainText(/FPL data shows none of your 15 near a price change/);
  });

  test("a forecast built before the price fields existed shows a neutral row, not 'no change'", async ({ page }) => {
    const fc = newestForecast();
    for (const p of fc.squad.players) delete p.priceWatch;
    await page.clock.install({ time: Date.parse(fc.deadlineTime) - 5 * 3_600_000 });
    await page.route("**/api/forecast*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fc) }));
    await mockLive(page, { current: "a" });
    await page.goto("/?team=999999&tab=squad");
    await expect(page.getByText("Price changes (FPL)")).toBeVisible();
    await expect(priceRowBox(page)).toContainText("Not in this build yet");
    await expect(priceRowBox(page)).not.toContainText(/near a price change/);
  });
});

test.describe("Opens on the right view for the week", () => {
  const activeTab = (page: Page) => page.locator(".sticky .segment button[data-active='true']");

  test("before the deadline it opens on Squad with the week's decisions", async ({ page }) => {
    await page.clock.install({ time: Date.parse(latestDeadline()) - 3 * 24 * 3_600_000 });
    await mockLive(page, { current: "a" });
    await page.goto("/");
    await expect(activeTab(page)).toHaveText("Squad");
    await expect(page.getByText("THIS WEEK’S DECISIONS")).toBeVisible();
  });

  test("it flips to Live by itself when the deadline passes", async ({ page }) => {
    await page.clock.install({ time: Date.parse(latestDeadline()) - 60_000 });
    await mockLive(page, { current: "a" });
    await page.goto("/");
    await expect(activeTab(page)).toHaveText("Squad");
    await page.clock.fastForward(120_000);
    await expect(activeTab(page)).toHaveText("Live");
  });

  test("after the deadline it opens on Live", async ({ page }) => {
    await page.clock.install({ time: Date.parse(latestDeadline()) + 3_600_000 });
    await mockLive(page, { current: "a" });
    await page.goto("/");
    await expect(activeTab(page)).toHaveText("Live");
  });
});

test.describe("Owner-only routes", () => {
  // These hit the real routes (no page mocks). With no OWNER_SECRET set, or no
  // unlock cookie, they must refuse before doing anything.
  for (const [method, url] of [
    ["post", "/api/rebuild"],
    ["post", "/api/transfers"],
    ["delete", "/api/transfers"],
  ] as const) {
    test(`${method.toUpperCase()} ${url} is locked without the owner key`, async ({ request }) => {
      const res = await request[method](url, { data: { outId: 1, inId: 2, basedOnGw: 1 } });
      expect(res.status()).toBe(401);
      expect((await res.json()).locked).toBe(true);
    });
  }

  test("a wrong key does not unlock", async ({ request }) => {
    const res = await request.post("/api/owner", { data: { secret: "nope" } });
    expect(res.status()).toBe(401);
    expect((await (await request.get("/api/owner")).json()).owner).toBe(false);
  });
});

test.describe("Appearance review page", () => {
  test("lists the players still to check and every club kit, without sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/appearance");
    await expect(page.getByRole("heading", { name: "Appearance review" })).toBeVisible();
    await expect(page.getByTestId("kit-list").locator("li")).toHaveCount(20);
    await expect(page.getByRole("button", { name: /^Copy an override for/ }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("3D Squad pitch", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("fpl-pitch-passing", "off"); } catch {} // keep these tests still and quick
    });
    await mockLive(page, { current: "a" }); // CI reaches live data, so the Live tab's pitch is in the page too
    await page.addInitScript(() => {
      try { localStorage.setItem("fpl-pitch-view", "3d"); } catch {}
    });
  });

  test("shows all fifteen players with the captain marked, and a tap opens the breakdown", async ({ page }) => {
    await page.goto("/?tab=squad");
    const pitch = squadPitch3d(page);
    await pitch.scrollIntoViewIfNeeded(); // the 3D canvas is only built once the pitch is on screen
    await expect(pitch.locator("canvas")).toBeVisible();
    await expect(pitch.locator("[data-tag]")).toHaveCount(15);
    await expect(pitch.getByText("C", { exact: true })).toHaveCount(1);
    await pitch.locator("[data-tag]").first().dispatchEvent("click"); // the tag itself, wherever it sits on screen
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("the 2D switch shows the flat pitch and the choice is remembered", async ({ page }) => {
    await page.goto("/?tab=squad");
    await expect(squadPitch3d(page)).toBeVisible();
    await page.evaluate(() => localStorage.removeItem("fpl-pitch-view"));
    await squadPitch3d(page).locator("xpath=ancestor::div[contains(@class,'panel')][1]").getByRole("group", { name: "Pitch view" }).getByRole("button", { name: "2D" }).click();
    await expect(page.getByTestId("pitch3d")).toHaveCount(0);
    await expect(page.locator(".floodlit-pitch").first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("fpl-pitch-view"))).toBe("2d");
  });

  test("the Live tab draws the same pitch in 3D with live points", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await expect(pitch.locator("canvas")).toBeVisible();
    await expect(pitch.locator("button[data-tag]").first()).toBeVisible();
    await page.getByRole("button", { name: /^Van Dijk,/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("the Scenarios tab has the same 2D/3D switch", async ({ page }) => {
    await page.goto("/?tab=scenarios");
    await expect(page.getByRole("group", { name: "Pitch view" }).first()).toBeVisible();
  });
});

test.describe("3D pitch moves", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("fpl-pitch-passing", "off"); } catch {}
    });
    await page.addInitScript(() => {
      try { localStorage.setItem("fpl-pitch-view", "3d"); } catch {}
    });
    await mockLive(page, { current: "a" });
  });

  test("tapping a scorer sends the camera in and he celebrates; the sheet opens and Escape glides back", async ({ page }) => {
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Gross"]').waitFor();
    await pitch.locator('button[aria-label^="Gross"]').dispatchEvent("click");
    await expect(pitch).toHaveAttribute("data-focus", /\d+/);
    await expect(pitch).toHaveAttribute("data-celebrating", "goal");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(pitch).not.toHaveAttribute("data-celebrating", /.+/, { timeout: 25000 }); // the move finishes (wall time stretches on a slow machine: the stage caps each step at 0.05s)
    await page.keyboard.press("Escape");
    await expect(pitch).not.toHaveAttribute("data-focus", /.+/);
  });

  test("a goal that arrives in a later poll makes the scorer celebrate without any tap", async ({ page }) => {
    const poll = { current: "a" as "a" | "b" };
    await page.unroute("**/api/live*");
    await mockLive(page, poll);
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Palmer"]').waitFor();
    poll.current = "b"; // Palmer scores
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(pitch).toHaveAttribute("data-celebrating", "goal", { timeout: 10000 });
    await expect(pitch).not.toHaveAttribute("data-focus", /.+/); // nobody selected, camera untouched
    await expect(pitch).not.toHaveAttribute("data-celebrating", /.+/, { timeout: 25000 }); // and it ends (the stage caps each step at 0.05s, so on a slow or busy machine 3.6s of animation takes far longer in wall time)
  });

  test("the ball stays put during a live celebration and the passing resumes after it", async ({ page }) => {
    test.slow(); // several waits on a stage that slows down under load add up to more than the default limit
    await page.addInitScript(() => {
      try { localStorage.setItem("fpl-pitch-passing", "on"); } catch {}
    });
    const poll = { current: "a" as "a" | "b" };
    await page.unroute("**/api/live*");
    await mockLive(page, poll);
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Palmer"]').waitFor();
    await expect(pitch).toHaveAttribute("data-passes", /[1-9]/, { timeout: 15000 });
    poll.current = "b";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(pitch).toHaveAttribute("data-celebrating", "goal", { timeout: 10000 });
    await page.waitForTimeout(700); // a pass already in flight lands
    const at = await pitch.getAttribute("data-passes");
    await page.waitForTimeout(1800);
    await expect(pitch).toHaveAttribute("data-celebrating", "goal"); // still mid-celebration
    expect(await pitch.getAttribute("data-passes")).toBe(at);
    await expect(pitch).not.toHaveAttribute("data-celebrating", /.+/, { timeout: 25000 });
    await expect.poll(async () => await pitch.getAttribute("data-passes"), { timeout: 15000 }).not.toBe(at);
  });

  test("if the scorer leaves the lineup mid-celebration the pitch does not stay celebrating", async ({ page }) => {
    const poll = { current: "a" as "a" | "b" | "c" };
    await page.unroute("**/api/live*");
    await page.route("**/api/live*", (route) => {
      if (route.request().url().includes("squad=1")) return route.fulfill({ status: 503, body: "{}" });
      const d = JSON.parse(fixture(`live-${poll.current === "c" ? "b" : poll.current}.json`));
      if (poll.current === "c") {
        // Palmer (7) swaps places with the last sub (15): he is no longer one of the eleven
        const { starters, bench } = d.picks as { starters: number[]; bench: number[] };
        starters[starters.indexOf(7)] = 15;
        bench[bench.indexOf(15)] = 7;
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
    });
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Palmer"]').waitFor();
    poll.current = "b";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(pitch).toHaveAttribute("data-celebrating", "goal", { timeout: 10000 });
    poll.current = "c";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(pitch).not.toHaveAttribute("data-celebrating", /.+/, { timeout: 2500 });
  });

  test("the first poll alone never celebrates, even with goals already in it", async ({ page }) => {
    const poll = { current: "b" as "a" | "b" };
    await page.unroute("**/api/live*");
    await mockLive(page, poll);
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Palmer"]').waitFor();
    await page.waitForTimeout(2500);
    await expect(pitch).not.toHaveAttribute("data-celebrating", /.+/);
  });

  test("a clean sheet gets its own celebration", async ({ page }) => {
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Raya"]').waitFor();
    await pitch.locator('button[aria-label^="Raya"]').dispatchEvent("click");
    await expect(pitch).toHaveAttribute("data-celebrating", "cleanSheet");
  });

  test("a player with no goal or clean sheet gets the camera but no celebration", async ({ page }) => {
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Van Dijk"]').waitFor();
    await pitch.locator('button[aria-label^="Van Dijk"]').dispatchEvent("click");
    await expect(pitch).toHaveAttribute("data-focus", /\d+/);
    await page.waitForTimeout(1500);
    await expect(pitch).not.toHaveAttribute("data-celebrating", /.+/);
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("the camera still moves to the player but nobody celebrates", async ({ page }) => {
      await page.goto("/?tab=live");
      const pitch = page.getByTestId("pitch3d").first();
      await pitch.locator('button[aria-label^="Gross"]').waitFor();
      await pitch.locator('button[aria-label^="Gross"]').dispatchEvent("click");
      await expect(pitch).toHaveAttribute("data-focus", /\d+/);
      await page.waitForTimeout(1500);
      await expect(pitch).not.toHaveAttribute("data-celebrating", /.+/);
    });
  });
});

test.describe("Tab transitions", () => {
  test("switching tabs goes through a view transition and leaves the page clean", async ({ page }) => {
    await page.addInitScript(() => {
      const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
      const real = d.startViewTransition?.bind(d);
      (window as unknown as { __vt: number }).__vt = 0;
      if (real) d.startViewTransition = (cb) => { (window as unknown as { __vt: number }).__vt++; return real(cb); };
    });
    await page.goto("/?tab=live");
    await page.getByRole("button", { name: "Squad", exact: true }).click();
    await expect(page.getByText(/MODEL · GW/)).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-vt-dir", /.+/);
    expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBeGreaterThanOrEqual(1);
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("the tab just switches, with no transition", async ({ page }) => {
      await page.addInitScript(() => {
        const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
        const real = d.startViewTransition?.bind(d);
        (window as unknown as { __vt: number }).__vt = 0;
        if (real) d.startViewTransition = (cb) => { (window as unknown as { __vt: number }).__vt++; return real(cb); };
      });
      await page.goto("/?tab=live");
      await page.getByRole("button", { name: "Squad", exact: true }).click();
      await expect(page.getByText(/MODEL · GW/)).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBe(0);
    });
  });
});

test.describe("Rolling rank", () => {
  test("the estimated rank rolls to its new value when a poll changes it", async ({ page }) => {
    const calibration = (intercept: number) => ({ slope: -0.08, intercept, sampleSize: 6, lastKnownRank: 90000, lastKnownEvent: 9 });
    let intercept = 11.5;
    await page.route("**/api/live*", (route) => {
      const body = JSON.parse(fixture("live-a.json"));
      body.rankCalibration = calibration(intercept);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto("/?tab=live");
    const rank = page.getByTestId("rolling-number");
    await expect(rank).toBeVisible();
    const before = Number(await rank.getAttribute("data-value"));
    intercept = 10.8; // a better projected rank
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(async () => Number(await rank.getAttribute("data-value"))).toBeLessThan(before);
    const after = Number(await rank.getAttribute("data-value"));
    await expect(rank).toHaveText(`~${after.toLocaleString("en-US")}`, { timeout: 4000 }); // it lands on the new number
  });
});

test.describe("3D pitch layout and the player card", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("fpl-pitch-view", "3d");
        localStorage.setItem("fpl-pitch-passing", "off");
      } catch {}
    });
    await mockLive(page, { current: "a" });
  });

  test("names are shown in full on the pitch and on the bench", async ({ page }) => {
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator("button[data-tag]").first().waitFor();
    const cut = await pitch.locator("button[data-tag] span.truncate").evaluateAll((els) =>
      els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent),
    );
    expect(cut, "names cut off with an ellipsis").toEqual([]);
    const benchOverflow = await pitch.locator(".grid button[data-tag]").evaluateAll((els) =>
      els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent),
    );
    expect(benchOverflow, "bench cards whose text spills out").toEqual([]);
    await expect(pitch.locator(".grid button[data-tag]").first()).toContainText("Kinsky");
  });

  test("a tap opens a short card that leaves the pitch in view; Show all makes it the full sheet", async ({ page }) => {
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Gross"]').waitFor();
    await pitch.locator('button[aria-label^="Gross"]').dispatchEvent("click");
    const card = page.getByRole("dialog");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("aria-modal", "false");
    const box = await card.locator("> div").boundingBox();
    expect(box!.height, "the card leaves most of the screen").toBeLessThan(844 * 0.4);
    await expect(card.getByRole("button", { name: "Show all" })).toBeVisible();
    await card.getByRole("button", { name: "Show all" }).click();
    await expect(page.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(pitch).not.toHaveAttribute("data-focus", /.+/);
  });

  test("the card also closes from its own Close button and Escape", async ({ page }) => {
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Raya"]').waitFor();
    await pitch.locator('button[aria-label^="Raya"]').dispatchEvent("click");
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await pitch.locator('button[aria-label^="Raya"]').dispatchEvent("click");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("tapping a player never pushes the page sideways", async ({ page }) => {
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Gross"]').waitFor();
    await pitch.locator('button[aria-label^="Gross"]').dispatchEvent("click");
    await expect(pitch).toHaveAttribute("data-focus", /\d+/);
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      x: window.scrollX,
      panes: [...document.querySelectorAll(".overflow-hidden")].map((e) => e.scrollLeft).filter(Boolean),
    }));
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    expect(m.x).toBe(0);
    expect(m.panes).toEqual([]);
  });

  test("in the close-up, tags of players out of frame are hidden, not parked far off screen", async ({ page }) => {
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Gross"]').waitFor();
    await pitch.locator('button[aria-label^="Gross"]').dispatchEvent("click");
    await page.waitForTimeout(1500);
    const off = await pitch.locator("div.pointer-events-none button[data-tag]").evaluateAll((els) =>
      els.map((e) => e.hasAttribute("data-pitch-off")),
    );
    expect(off).toContain(false); // the player in frame
    expect(off).toContain(true); // players out of frame are made invisible, not parked far away
    // they stay reachable by keyboard
    const stillFocusable = await pitch.locator("button[data-pitch-off]").first().evaluate((e) => (e as HTMLButtonElement).tabIndex >= 0 && getComputedStyle(e).display !== "none");
    expect(stillFocusable).toBe(true);
  });
});

test.describe("The short player card and the keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("fpl-pitch-view", "3d");
        localStorage.setItem("fpl-pitch-passing", "off");
      } catch {}
    });
  });

  test("on the Squad pitch the Replace action sits beside Show all, and the clipped preview cannot be tabbed into", async ({ page }) => {
    await page.goto("/?tab=squad");
    const pitch = page.locator(".panel", { has: page.getByText(/MODEL · GW/) }).first().getByTestId("pitch3d");
    await pitch.locator("button[data-tag]").first().waitFor();
    await pitch.locator("button[data-tag]").first().dispatchEvent("click");
    const card = page.getByRole("dialog");
    await expect(card).toHaveAttribute("aria-modal", "false");
    // one copy in the clipped, inert preview and one in the button row: the row's is the last
    await expect(card.getByRole("button", { name: /^Replace / }).last()).toBeVisible();
    await expect(card.getByRole("button", { name: "Show all" })).toBeVisible();
    expect(await card.locator("[inert]").count(), "the clipped preview is inert").toBe(1);
  });
});

test.describe("Subs strip", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("fpl-pitch-view", "3d");
        localStorage.setItem("fpl-pitch-passing", "off");
      } catch {}
    });
  });

  test("Live: subs are a dashed strip in sub order, with name, score and icons; none are drawn on the pitch", async ({ page }) => {
    await mockLive(page, { current: "a" });
    await page.goto("/?tab=live");
    const strip = page.getByTestId("subs-strip").first();
    await strip.waitFor();
    await expect(strip).toContainText("Subs");
    const cards = strip.locator("button[data-tag]");
    await expect(cards).toHaveCount(4);
    // the goalkeeper is GK, the outfield subs are numbered 1, 2, 3 in the order they would come on
    await expect(cards.nth(0)).toContainText("Kinsky");
    await expect(cards.nth(0)).toContainText("GK");
    await expect(cards.nth(1)).toContainText("Barry");
    await expect(cards.nth(1)).toContainText("-2"); // his points
    await expect(cards.nth(1).locator("span[title^='Sub number']")).toHaveText("1");
    await expect(cards.nth(2).locator("span[title^='Sub number']")).toHaveText("2");
    await expect(cards.nth(3).locator("span[title^='Sub number']")).toHaveText("3");
    expect(await cards.first().evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("dashed");
    // only the eleven are floating tags on the pitch
    await expect(page.getByTestId("pitch3d").first().locator("div.pointer-events-none button[data-tag]")).toHaveCount(11);
  });

  test("Squad: subs show their expected points", async ({ page }) => {
    await page.goto("/?tab=squad");
    const pitch = page.locator(".panel", { has: page.getByText(/MODEL · GW/) }).first().getByTestId("pitch3d");
    const strip = pitch.getByTestId("subs-strip");
    await strip.waitFor();
    const cards = strip.locator("button[data-tag]");
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
    for (const text of await cards.allInnerTexts()) expect(text).toMatch(/\d+\.\d/); // an xP like 3.4
  });
});

test.describe("Ball going round the pitch", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("fpl-pitch-view", "3d"); } catch {}
    });
    await mockLive(page, { current: "a" });
  });

  test("the ball is passed around while nobody is selected, and the players stay where they are", async ({ page }) => {
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator("button[data-tag]").first().waitFor();
    const spots = () =>
      pitch.locator("div.pointer-events-none button[data-tag]").evaluateAll((els) =>
        els.map((e) => [e.getAttribute("data-tag"), (e as HTMLElement).style.transform]),
      );
    await expect(pitch).toHaveAttribute("data-passes", /[1-9]/, { timeout: 15000 });
    const before = await spots();
    await expect.poll(async () => Number(await pitch.getAttribute("data-passes")), { timeout: 15000 }).toBeGreaterThanOrEqual(3);
    expect(await spots()).toEqual(before);
  });

  test("the passing switch turns it off, and the choice is remembered", async ({ page }) => {
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator("button[data-tag]").first().waitFor();
    const toggle = page.getByRole("button", { name: /^Passing/ }).first();
    await expect(toggle).toHaveText("Passing on");
    await toggle.click();
    await expect(toggle).toHaveText("Passing off");
    expect(await page.evaluate(() => localStorage.getItem("fpl-pitch-passing"))).toBe("off");
    await page.waitForTimeout(800); // a pass in flight lands
    const at = await pitch.getAttribute("data-passes");
    await page.waitForTimeout(2500);
    expect(await pitch.getAttribute("data-passes")).toBe(at);
  });

  test("it stops while a player is selected", async ({ page }) => {
    await page.goto("/?tab=live");
    const pitch = page.getByTestId("pitch3d").first();
    await pitch.locator('button[aria-label^="Gross"]').waitFor();
    await expect(pitch).toHaveAttribute("data-passes", /[1-9]/, { timeout: 15000 });
    await pitch.locator('button[aria-label^="Gross"]').dispatchEvent("click");
    await expect(pitch).toHaveAttribute("data-focus", /\d+/);
    await page.waitForTimeout(800); // let any pass in flight finish its count
    const at = await pitch.getAttribute("data-passes");
    await page.waitForTimeout(2500);
    expect(await pitch.getAttribute("data-passes")).toBe(at);
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("nobody passes, and there is no passing switch to show", async ({ page }) => {
      await page.goto("/?tab=live");
      const pitch = page.getByTestId("pitch3d").first();
      await pitch.locator("button[data-tag]").first().waitFor();
      await page.waitForTimeout(3000);
      await expect(pitch).not.toHaveAttribute("data-passes", /.+/);
      await expect(page.getByRole("button", { name: /^Passing/ })).toHaveCount(0);
    });
  });
});

test.describe("Squad correction from your live squad", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("fpl-pitch-view", "2d");
      } catch {}
    });
  });

  test("a transfer made in FPL since the last build shows on the Squad pitch, with a banner naming it", async ({ page }) => {
    const { squad, pool, basedOn } = forecastSquad();
    const leaver = squad.find((p) => p.position === "DEF")!;
    const joiner = pool.find((p) => p.position === "DEF" && !squad.some((s) => s.id === p.id))!;
    const live = squad.map((p) => ({ id: p.id === leaver.id ? joiner.id : p.id, position: p.position }));
    await page.route("**/api/live*", (route) =>
      route.request().url().includes("squad=1")
        ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ gameweek: basedOn + 1, chip: null, squad: live }) })
        : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await page.goto("/?tab=squad");
    const banner = page.getByTestId("squad-sync-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`${leaver.webName} \u2192 ${joiner.webName}`);
  });

  for (const width of [360, 390]) {
    test(`a joiner who out-scores a starter starts and the displaced player is benched, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const { squad, basedOn } = forecastSquad();
      const dir = join(__dirname, "..", "..", "data", "forecast");
      const latest = readdirSync(dir).map((f) => /^gw(\d+)\.json$/.exec(f)).filter((m): m is RegExpExecArray => !!m).sort((a, b) => Number(b[1]) - Number(a[1]))[0][0];
      const f = JSON.parse(readFileSync(join(dir, latest), "utf8"));
      const u = f.upcoming[0];
      const xp = new Map<number, number>(u.players.map((p: { id: number; projectedPoints: number }) => [p.id, p.projectedPoints]));
      const name = new Map<number, string>(squad.map((p) => [p.id, p.webName]));
      const inSquad = new Set(squad.map((p) => p.id));
      // the benched defender leaves; the best defender outside the squad joins and beats the weakest starting defender
      const leaver = (u.bench as number[]).map((id) => squad.find((p) => p.id === id)!).find((p) => p.position === "DEF")!;
      const startDefs = (u.startingXi as number[]).filter((id) => squad.find((p) => p.id === id)?.position === "DEF");
      const weakest = startDefs.sort((a, b) => xp.get(a)! - xp.get(b)!)[0];
      const joiner = (f.pool as { id: number; webName: string; position: string; perGameweek: number[] }[])
        .filter((p) => p.position === "DEF" && !inSquad.has(p.id))
        .sort((a, b) => b.perGameweek[0] - a.perGameweek[0])[0];
      expect(joiner.perGameweek[0]).toBeGreaterThan(xp.get(weakest)! + 0.3);
      const live = squad.map((p) => ({ id: p.id === leaver.id ? joiner.id : p.id, position: p.position }));
      await page.route("**/api/live*", (route) =>
        route.request().url().includes("squad=1")
          ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ gameweek: basedOn + 1, chip: null, squad: live }) })
          : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
      );
      await page.goto("/?tab=squad");
      const panel = page.locator(".panel", { has: page.getByText(/MODEL · GW/) }).first();
      await panel.scrollIntoViewIfNeeded();
      const bench = panel.getByTestId("pitch-bench");
      await expect(page.getByTestId("squad-sync-banner")).toContainText("lineup re-picked for your transfers");
      // joiner starts (on the pitch, not in the bench row); displaced starter is benched
      await expect(bench.getByRole("button", { name: new RegExp(`^${joiner.webName}:`) })).toHaveCount(0);
      await expect(panel.getByRole("button", { name: new RegExp(`^${joiner.webName}:`) })).toHaveCount(1);
      // somebody the model started now sits on the bench (which starter depends on the formation rules)
      const modelStarters = (u.startingXi as number[]).map((id) => name.get(id)!);
      await expect(bench.getByRole("button")).toHaveCount(4);
      const benchLabels = await bench.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
      expect(benchLabels.filter((l) => modelStarters.some((n) => l.startsWith(`${n}:`))).length).toBeGreaterThanOrEqual(1);
      await expect(bench.getByRole("button", { name: new RegExp(`^${leaver.webName}:`) })).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/repick-${width}.png` });
    });
  }

  test("nothing changed: no banner", async ({ page }) => {
    const { squad, basedOn } = forecastSquad();
    await page.route("**/api/live*", (route) =>
      route.request().url().includes("squad=1")
        ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ gameweek: basedOn + 1, chip: null, squad: squad.map((p) => ({ id: p.id, position: p.position })) }) })
        : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await page.goto("/?tab=squad");
    await expect(page.getByText(/MODEL · GW/)).toBeVisible();
    await expect(page.getByTestId("squad-sync-banner")).toHaveCount(0);
  });

  test("a live squad for the same gameweek the model was built from is not used (it would undo saved transfers)", async ({ page }) => {
    const { squad, pool, basedOn } = forecastSquad();
    const leaver = squad.find((p) => p.position === "DEF")!;
    const joiner = pool.find((p) => p.position === "DEF" && !squad.some((s) => s.id === p.id))!;
    const live = squad.map((p) => ({ id: p.id === leaver.id ? joiner.id : p.id, position: p.position }));
    await page.route("**/api/live*", (route) =>
      route.request().url().includes("squad=1")
        ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ gameweek: basedOn, chip: null, squad: live }) })
        : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await page.goto("/?tab=squad");
    await expect(page.getByText(/MODEL · GW/)).toBeVisible();
    await expect(page.getByTestId("squad-sync-banner")).toHaveCount(0);
  });

  test("a Free Hit squad is not mistaken for your squad", async ({ page }) => {
    const { squad, pool, basedOn } = forecastSquad();
    const leaver = squad.find((p) => p.position === "DEF")!;
    const joiner = pool.find((p) => p.position === "DEF" && !squad.some((s) => s.id === p.id))!;
    const live = squad.map((p) => ({ id: p.id === leaver.id ? joiner.id : p.id, position: p.position }));
    await page.route("**/api/live*", (route) =>
      route.request().url().includes("squad=1")
        ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ gameweek: basedOn + 1, chip: "freehit", squad: live }) })
        : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await page.goto("/?tab=squad");
    await expect(page.getByText(/MODEL · GW/)).toBeVisible();
    await expect(page.getByTestId("squad-sync-banner")).toHaveCount(0);
  });

  test("live data unavailable: the pitch is left as the model built it", async ({ page }) => {
    await page.goto("/?tab=squad");
    await expect(page.getByText(/MODEL · GW/)).toBeVisible();
    await expect(page.getByTestId("squad-sync-banner")).toHaveCount(0);
  });

  test("the incoming player opens a sheet that says he is already in your FPL squad, with no undo", async ({ page }) => {
    const { squad, pool, startingXi, basedOn } = forecastSquad();
    const leaver = squad.find((p) => p.position === "DEF" && startingXi.includes(p.id))!;
    const joiner = pool.find((p) => p.position === "DEF" && !squad.some((s) => s.id === p.id))!;
    const live = squad.map((p) => ({ id: p.id === leaver.id ? joiner.id : p.id, position: p.position }));
    await page.route("**/api/live*", (route) =>
      route.request().url().includes("squad=1")
        ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ gameweek: basedOn + 1, chip: null, squad: live }) })
        : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await page.goto("/?tab=squad");
    await page.getByTestId("squad-sync-banner").waitFor();
    const scene = page.locator(".floodlit-pitch").filter({ has: page.locator("button[data-flip]") }).first();
    await scene.locator("button[data-flip]", { hasText: joiner.webName }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("In your FPL squad now");
    await expect(sheet).toContainText(leaver.webName);
    await expect(sheet.getByRole("button", { name: /^Undo/ })).toHaveCount(0);
  });
});

test.describe("What could still move your rank", () => {
  const withThreats = (threats: unknown[]) =>
    JSON.stringify({ ...JSON.parse(fixture("live-a.json")), threats });
  const mockThreats = (page: Page, threats: unknown[]) =>
    page.route("**/api/live*", (route) =>
      route.request().url().includes("squad=1")
        ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
        : route.fulfill({ contentType: "application/json", body: withThreats(threats) }),
    );
  const foden = { id: 900, webName: "Foden", team: "MCI", ownedPct: 41.2, opponent: "TOT (A)", kickoffTime: "2026-10-11T15:30:00Z", components: { goals: 1.5, minutes: 2 } };

  for (const width of [360, 390]) {
    test(`quotes ownership and kickoff for a popular player you do not own, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockThreats(page, [foden, { ...foden, id: 901, webName: "Ghost", ownedPct: 0 }, { ...foden, id: 902, webName: "NoGame", opponent: null }]);
      await page.goto("/?tab=live");
      const card = page.getByTestId("rank-threats");
      await expect(card).toBeVisible();
      await expect(card).toContainText("41% of managers own Foden, he plays Sun 23:30 SGT vs TOT (A), not in your squad");
      await expect(card).not.toContainText("Ghost");
      await expect(card).not.toContainText("NoGame");
      await expect(card.getByRole("heading", { name: /what could move your rank/i })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/rank-threats-${width}.png` });
    });
  }

  for (const width of [360, 390]) {
    test(`is one card with the count, the kickoff list and the threat lines, no duplicate headings, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockThreats(page, [foden]);
      await page.goto("/?tab=live");
      const card = page.getByTestId("rank-threats");
      await expect(card).toBeVisible();
      await expect(page.getByTestId("rank-threats")).toHaveCount(1);
      await expect(card.getByTestId("still-to-play-count")).toContainText(/\d+ of your XI (has|have) a match left/);
      await expect(card.getByTestId("next-up")).toContainText("Playing now");
      await expect(card.getByTestId("next-up")).toContainText("Sun 23:30");
      await expect(card.locator("[data-kind='yours']").first()).toBeVisible();
      await expect(card.locator("[data-kind='missing']")).toHaveCount(1);
      await expect(page.getByText("Still to come", { exact: true })).toHaveCount(0); // the old second card's heading
      await expect(page.getByRole("heading", { name: /still to play/i })).toHaveCount(1);
      // count line first, then the kickoff list, then the threat lines
      const y = async (loc: Locator) => (await loc.boundingBox())!.y;
      expect(await y(card.getByTestId("still-to-play-count"))).toBeLessThan(await y(card.getByTestId("next-up")));
      expect(await y(card.getByTestId("next-up"))).toBeLessThan(await y(card.locator("li").first()));
      // one explainer row, not two
      await expect(page.locator("details > summary", { hasText: /worked out/ })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/still-to-play-${width}.png` });
    });
  }

  test("with no ownership data the not-owned lines disappear and your own still show", async ({ page }) => {
    await mockThreats(page, []);
    await page.goto("/?tab=live");
    const card = page.getByTestId("rank-threats");
    await expect(card).toBeVisible();
    await expect(card.locator("[data-kind='missing']")).toHaveCount(0);
    await expect(card.locator("[data-kind='yours']").first()).toBeVisible();
  });
});

/** The committed forecast as /api/forecast would return it for a guest: no model record. */
function guestForecast() {
  const dir = join(__dirname, "..", "..", "data", "forecast");
  const latest = readdirSync(dir)
    .map((f) => /^gw(\d+)\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(b[1]) - Number(a[1]))[0][0];
  const f = JSON.parse(readFileSync(join(dir, latest), "utf8"));
  f.teamName = "Guest FC";
  f.managerName = "Gus Guest";
  f.runningRecord = null;
  f.parCalibration = null;
  if (f.lastGameweek) delete f.lastGameweek.modelVsBaseline;
  for (const g of f.history?.gameweeks ?? []) delete g.modelVsBaseline;
  return f;
}

test.describe("Guest teams", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  const enterTeam = async (page: Page, id: string) => {
    await page.goto("/");
    await page.getByRole("textbox", { name: "FPL team ID" }).fill(id);
    await page.getByRole("button", { name: "View squad" }).click();
  };

  // This only proves the client renders a record-less forecast; that the server omits the record is
  // covered by tests/test_forecast_api.py.
  test("a guest sees the empty-state copy, not the owner's model record; the owner still sees it", async ({ page, context }) => {
    await page.route("**/api/forecast*", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(guestForecast()) }),
    );
    await enterTeam(page, "424242");
    await expect(page.getByTestId("team-bar")).toContainText("Guest FC");
    await openTab(page, "Squad");
    await expect(page.getByTestId("guest-record-empty")).toBeAttached();
    await expect(page.getByText(/Out-of-sample/)).toHaveCount(0);
    await expect(page.getByText(/Par calibration/)).toHaveCount(0);
    await expect(page.getByText(/\bm-?\d+ b-?\d+\b/)).toHaveCount(0); // History's model/baseline marks

    await context.addCookies([{ name: "fpl_team_id", value: OWNER, url: ORIGIN }]);
    await page.goto("/?tab=squad");
    await expect(page.getByText(/Out-of-sample/).first()).toBeAttached();
    await expect(page.getByTestId("guest-record-empty")).toHaveCount(0);
  });

  const cases: [number, string, RegExp][] = [
    [404, "RAW-SERVER-404", /FPL has no team with ID 777/],
    [422, "RAW-SERVER-422", /Team 777 has no squad recorded[\s\S]*Check back/],
    [503, "RAW-SERVER-503", /first gameweek hasn.t finished yet[\s\S]*Try again later/],
  ];
  for (const [status, serverText, expected] of cases) {
    test(`HTTP ${status} shows a specific message with a next step`, async ({ page }) => {
      await page.route("**/api/forecast*", (route) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: serverText }) }),
      );
      await enterTeam(page, "777");
      await expect(page.locator("span[role=alert]")).toContainText(expected);
      await expect(page.getByText(serverText)).toHaveCount(0); // the raw server text is not shown
    });
  }

  test("a pasted FPL address or a padded ID is turned into the team ID", async ({ page }) => {
    let asked = "";
    await page.route("**/api/forecast*", (route) => {
      asked = new URL(route.request().url()).searchParams.get("teamId") ?? "";
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(guestForecast()) });
    });
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "FPL team ID" });
    await input.fill("https://fantasy.premierleague.com/entry/424242/event/10");
    await expect(input).toHaveValue("424242");
    await input.fill(" 424242 ");
    await expect(input).toHaveValue("424242");
    await page.getByRole("button", { name: "View squad" }).click();
    await expect(page.getByTestId("team-bar")).toContainText("Guest FC");
    expect(asked).toBe("424242");
  });

  test("a platform timeout (504) says it timed out; a non-JSON 404 does not claim the team is unknown", async ({ page }) => {
    await page.route("**/api/forecast*", (route) => route.fulfill({ status: 504, body: "gateway timeout" }));
    await enterTeam(page, "777");
    await expect(page.locator("span[role=alert]")).toContainText(/taking too long/);
    await page.unroute("**/api/forecast*");
    await page.route("**/api/forecast*", (route) => route.fulfill({ status: 404, body: "<html>not found</html>" }));
    await page.getByRole("button", { name: "View squad" }).click();
    await expect(page.locator("span[role=alert]")).not.toContainText(/no team with ID/);
    await expect(page.locator("span[role=alert]")).toContainText(/Couldn't get your forecast/);
  });

  test("a bad saved team ID does not greet the visitor with an error", async ({ page, context }) => {
    await context.addCookies([{ name: "fpl_team_id", value: "0123", url: ORIGIN }]);
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "FPL team ID" })).toBeVisible();
    await expect(page.locator("span[role=alert]")).toHaveCount(0);
  });

  test("Switch team while a lookup is loading is not undone when the lookup answers", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/forecast*", async (route) => {
      calls++;
      if (calls > 1) await new Promise((r) => setTimeout(r, 2000));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(guestForecast()) }).catch(() => {});
    });
    await enterTeam(page, "424242");
    const bar = page.getByTestId("team-bar");
    await expect(bar).toContainText("Guest FC");
    await openTeamMenu(page, "Change team");
    await bar.getByRole("textbox", { name: "Team ID" }).fill("535353");
    await bar.getByRole("button", { name: "View", exact: true }).click(); // slow second lookup
    await openTeamMenu(page, "Change team");
    await bar.getByRole("button", { name: "Switch team" }).click();
    await page.waitForTimeout(3000);
    await expect(page.getByRole("textbox", { name: "FPL team ID" })).toBeVisible(); // still on the gate
    await expect(page.locator("span[role=alert]")).toHaveCount(0);
  });

  test("after 3 seconds a slow forecast says it is being built", async ({ page }) => {
    await page.route("**/api/forecast*", async (route) => {
      await new Promise((r) => setTimeout(r, 4500));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(guestForecast()) });
    });
    await enterTeam(page, "424242");
    const note = page.getByText("Building your forecast, about 10 seconds the first time.");
    await expect(note).toHaveCount(0);
    await expect(note).toBeVisible({ timeout: 4000 });
    await expect(page.getByTestId("team-bar")).toContainText("Guest FC", { timeout: 10_000 });
    await expect(note).toHaveCount(0);
  });

  test("the first-visit gate says what the app is and blocks invalid team IDs", async ({ page }) => {
    let requests = 0;
    await page.route("**/api/forecast*", (route) => {
      requests++;
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });
    await page.goto("/");
    await expect(page.getByText(/decision tool for managers/)).toBeVisible();
    await expect(page.getByText(/Saving transfers is only available for this app/)).toBeVisible();
    const input = page.getByRole("textbox", { name: "FPL team ID" });
    const go = page.getByRole("button", { name: "View squad" });
    await expect(go).toBeDisabled();
    await input.fill("0123");
    await expect(go).toBeDisabled();
    await input.fill("1234567890"); // ten digits
    await expect(go).toBeDisabled();
    await expect(input).toHaveAttribute("aria-describedby", "team-id-hint");
    await input.fill("abc");
    await expect(input).toHaveValue(""); // letters are dropped
    await input.fill("123456789");
    await expect(go).toBeEnabled();
    expect(requests).toBe(0);
  });
});
