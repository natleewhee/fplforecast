import { defineConfig, devices } from "@playwright/test";

/* Browser smoke tests: they open the real built app at phone width, replay
 * recorded /api/live payloads (built by the real buildLivePayload, see
 * tests/e2e/fixtures), and check the screens that have broken before.
 *
 *   npm run test:e2e
 *
 * CHROMIUM_PATH points at an already-installed Chromium (used in sandboxes);
 * otherwise Playwright's own browser is used (`npx playwright install chromium`). */

const PORT = 3123;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Pixel 7"],
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
