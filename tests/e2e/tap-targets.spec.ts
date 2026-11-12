import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Tab semantics and 44x44px tap targets (WCAG 2.5.5) on a phone.
 *
 * Tap areas are measured by probing elementFromPoint outwards from each control's centre, not by
 * reading its box: several controls look smaller than they are (see .hit-44 and .segment in
 * globals.css), and a box reading would miss both that and a neighbour covering part of it. */

const OWNER = "1168513";
const ORIGIN = `http://localhost:${process.env.PW_PORT ?? 3123}`;
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{ name: "fpl_team_id", value: OWNER, url: ORIGIN }]);
  await page.route("**/api/live*", (route) =>
    route.request().url().includes("squad=1")
      ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
      : route.fulfill({ contentType: "application/json", body: fixture("live-a.json") }),
  );
  await page.route("**/api/recap*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
});

type Probe = { name: string; w: number; h: number; stolenBy: string | null; pitchTag: boolean };

/** Every visible control in the page chrome and the open tab, with the size of the area where a tap lands on it. */
async function probe(page: Page): Promise<Probe[]> {
  const handles = await page.locator(
    "button:visible, a[href]:visible, summary:visible, input:not([type=hidden]):visible, select:visible",
  ).elementHandles() as import("@playwright/test").ElementHandle<HTMLElement>[];
  const out: Probe[] = [];
  for (const h of handles) {
    const skip = await h.evaluate((el) => !!el.closest("[inert]") || (el as HTMLButtonElement).disabled || el.getBoundingClientRect().width === 0);
    if (skip) continue;
    // Put it mid-screen so the sticky tab bar and the screen edges do not cut the probe short.
    await h.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
    out.push(
      await h.evaluate((el) => {
        const sel = "button, a[href], summary, input, select, [role=tab]";
        const owner = (x: number, y: number) => document.elementFromPoint(x, y)?.closest(sel) ?? null;
        const b = el.getBoundingClientRect();
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        let edge = "";
        const reach = (dx: number, dy: number) => {
          let n = 0;
          while (n < 60 && owner(cx + dx * (n + 1), cy + dy * (n + 1)) === el) n++;
          if (n < 22) {
            const at = document.elementFromPoint(cx + dx * (n + 1), cy + dy * (n + 1));
            edge ||= ` [${dx},${dy}] stops at ${at?.tagName}.${(at as HTMLElement | null)?.className?.toString().slice(0, 50)}`;
          }
          return n;
        };
        const hitW = owner(cx, cy) === el ? reach(-1, 0) + reach(1, 0) + 1 : 0;
        const hitH = owner(cx, cy) === el ? reach(0, -1) + reach(0, 1) + 1 : 0;
        // Does another control's tap area cover part of this one?
        let stolenBy: string | null = null;
        for (const fx of [0.15, 0.5, 0.85])
          for (const fy of [0.15, 0.5, 0.85]) {
            const o = owner(b.left + b.width * fx, b.top + b.height * fy);
            if (o && o !== el && !el.contains(o) && !o.contains(el)) stolenBy ??= (o.getAttribute("aria-label") || o.textContent || "?").trim().slice(0, 30);
          }
        const name = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
        return { name: name + edge, w: hitW, h: hitH, stolenBy, pitchTag: el.hasAttribute("data-tag") };
      }),
    );
  }
  return out;
}

// A 44px control centred on a half pixel probes as 43, so 43 passes.
// The 3D pitch's name tags are the one exception: neighbouring players sit closer than 44px, so a
// 44px area each would overlap and a tap could open the wrong player. They are held to WCAG 2.5.8's
// 24px minimum instead, and must not cover each other (checked by "stolen" for every control).
const tooSmall = (ps: Probe[]) =>
  ps.filter((p) => (p.pitchTag ? p.w < 24 || p.h < 24 : p.w < 43 || p.h < 43)).map((p) => `${p.name}: ${p.w}x${p.h}`);
const stolen = (ps: Probe[]) => ps.filter((p) => p.stolenBy).map((p) => `${p.name} <- ${p.stolenBy}`);

test("the tab bar is a tablist: arrows move between tabs, only the open tab is a Tab stop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?tab=squad");
  const list = page.getByRole("tablist", { name: "Sections" });
  await expect(list.getByRole("tab")).toHaveCount(4);
  const squad = list.getByRole("tab", { name: "Squad" });
  await expect(squad).toHaveAttribute("aria-selected", "true");
  await expect(list.locator("[tabindex='0']")).toHaveCount(1);
  // the open tab names its panel, and the panel is labelled by the tab
  const panelId = await squad.getAttribute("aria-controls");
  const panel = page.locator(`#${panelId}`);
  await expect(panel).toHaveAttribute("role", "tabpanel");
  await expect(panel).toHaveAttribute("aria-labelledby", (await squad.getAttribute("id"))!);
  await expect(panel).not.toHaveAttribute("inert");

  await squad.focus();
  await page.keyboard.press("ArrowRight");
  const scen = list.getByRole("tab", { name: "Scenarios" });
  await expect(scen).toHaveAttribute("aria-selected", "true");
  await expect(scen).toBeFocused();
  await page.keyboard.press("End");
  await expect(list.getByRole("tab", { name: "Leagues" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight"); // wraps round
  const live = list.getByRole("tab", { name: "Live" });
  await expect(live).toHaveAttribute("aria-selected", "true");
  await expect(live).toBeFocused();
  await page.keyboard.press("ArrowLeft"); // and back the other way
  await expect(list.getByRole("tab", { name: "Leagues" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(live).toHaveAttribute("aria-selected", "true");
  // quick repeat presses each move one tab, even mid-transition
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(list.getByRole("tab", { name: "Leagues" })).toHaveAttribute("aria-selected", "true");
  // Alt+Left is the browser's Back: the tab bar neither switches nor cancels it
  await page.evaluate(() => {
    window.addEventListener("keydown", (e) => { (window as unknown as { altPrevented: boolean }).altPrevented = e.defaultPrevented; }, { once: true });
  });
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(list.getByRole("tab", { name: "Leagues" })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => (window as unknown as { altPrevented: boolean }).altPrevented)).toBe(false);
  // panels that are not open stay inert
  await expect(page.locator("[role=tabpanel]:not([inert])")).toHaveCount(1);
});

for (const width of [360, 390]) {
  for (const view of ["2d", "3d"] as const) {
    test(`every control on all four tabs has a 44x44px tap area of its own at ${width}px (${view} pitch)`, async ({ page }) => {
      test.slow(); // a few hundred elementFromPoint probes per tab
      await page.addInitScript((v) => {
        try { localStorage.setItem("fpl-pitch-view", v); } catch {}
      }, view);
      await page.setViewportSize({ width, height: 800 });
      const problems: string[] = [];
      for (const tab of ["live", "squad", "scenarios", "leagues"]) {
        await page.goto(`/?tab=${tab}`);
        await page.waitForTimeout(1500);
        if (tab === "scenarios") {
          // open the first plan row so its compact squad pitch is measured too
          const row = page.locator("[role=tabpanel]:not([inert]) button[aria-expanded='false']").first();
          if (await row.count()) await row.click();
          await page.waitForTimeout(800);
        }
        const ps = await probe(page);
        expect(ps.length, `${tab}: found controls`).toBeGreaterThan(tab === "leagues" ? 0 : 3);
        problems.push(...tooSmall(ps).map((s) => `${tab} small: ${s}`), ...stolen(ps).map((s) => `${tab} covered: ${s}`));
      }
      expect(problems).toEqual([]);
    });
  }
}
