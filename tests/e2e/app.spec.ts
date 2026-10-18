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
    expect(shared).toContain("http://localhost:3123/");
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
      await page.goto("/");
      await page.getByRole("button", { name: /^Van Dijk,/ }).waitFor();
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
    expect((await bar.boundingBox())!.height).toBeLessThan(80); // one row, not two
    await bar.getByRole("button", { name: "Change team" }).click();
    await expect(bar.getByRole("textbox", { name: "Team ID" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "View" })).toBeDisabled(); // nothing typed yet
    await bar.getByRole("textbox", { name: "Team ID" }).fill("12");
    await expect(bar.getByRole("button", { name: "View" })).toBeEnabled();
  });
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
    await page.goto("/");
    const failed = page.getByTestId("live-failed");
    await expect(failed).toContainText("FPL is down");
    down = false;
    await failed.getByRole("button", { name: "Retry" }).click();
    await page.getByRole("button", { name: /^Van Dijk,/ }).waitFor();
    await expect(page.getByTestId("live-failed")).toHaveCount(0);
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
    // The checklist only appears in the last 24h before the deadline.
    await page.clock.install({ time: Date.parse(latestDeadline()) - 5 * 3_600_000 });
    await mockLive(page, { current: "a" });
    await open(page);
    await openTab(page, "Squad");
    await expect(page.getByText("Chips available")).toHaveCount(1);
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
