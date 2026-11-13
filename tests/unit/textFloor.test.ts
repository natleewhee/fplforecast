import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/* U3: nothing below 12px outside the labels drawn on the pitch itself. Those are listed here
 * with a reason; any other text-[9..11.5px] in src/app fails the test. */
const ON_PITCH: Record<string, string> = {
  "src/app/pitch3d/Pitch3D.tsx": "3D name tags, badges and the subs strip chips",
  "src/app/Shirt.tsx": "the shirt number on the 2D pitch",
  "src/app/tokenParts.tsx": "the armband letter",
  "src/app/PlayerFace.tsx": "face tokens on the 2D pitch",
  "src/app/BenchCover.tsx": "the subs strip",
  "src/app/Pitch.tsx": "2D player tokens (opponents, points)",
  "src/app/LivePitch.tsx": "live 2D tokens",
  "src/app/LiveSquadPitch.tsx": "live squad tokens",
  "src/app/FixtureTicker.tsx": "the fixture grid cells",
};
const SMALL = /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

test("no text under 12px outside the on-pitch labels", () => {
  const offenders: string[] = [];
  for (const f of files("src/app")) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (!SMALL.test(line)) return;
      // on-pitch files may keep small text only on labels drawn over the pitch: those carry a
      // text shadow or are token/tag/cell markup, never prose paragraphs or buttons
      if (f in ON_PITCH && !/<p\b|<summary\b|hit-44|min-h-11|role="status"/.test(line)) return;
      offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
