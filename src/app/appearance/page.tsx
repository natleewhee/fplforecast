import type { Metadata } from "next";
import { SKIN_STEPS, kitFor, reviewRank, unverified, type TraitState } from "@/lib/appearance";
import { loadAppearanceRows, loadKitTable, type AppearanceRow } from "@/lib/appearanceData";
import { Header, Panel, PositionBadge, Shell } from "../PageChrome";
import CopyOverride from "./CopyOverride";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Appearance review", robots: { index: false } };

const FIRST_BATCH = 100;

const STATE_TEXT: Record<TraitState, string> = { default: "guess", auto: "auto", verified: "checked" };
const STATE_CLASS: Record<TraitState, string> = { default: "chip chip-warn", auto: "chip", verified: "chip chip-accent" };

function Swatch({ colour, label }: { colour: string; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-white/20"
      style={{ background: colour }}
    />
  );
}

function snippet(r: AppearanceRow): string {
  const { cm, skin, hair } = r.look;
  return `"${r.code}": { "cm": ${cm.value}, "skin": ${skin.value}, "hair": { "style": "${hair.value.style}", "color": "${hair.value.color}" } }`;
}

function PlayerRow({ r }: { r: AppearanceRow }) {
  const { cm, skin, hair } = r.look;
  return (
    <li className="flex flex-col gap-2 border-b border-line py-3 last:border-0">
      <div className="flex items-center gap-2">
        <PositionBadge position={r.position} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{r.name}</span>
        <span className="font-mono text-[11px] text-ink-faint">{r.team}</span>
        <CopyOverride snippet={snippet(r)} label={r.name} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          {cm.value} cm <span className={STATE_CLASS[cm.state]}>{STATE_TEXT[cm.state]}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch colour={SKIN_STEPS[skin.value]} label={`skin step ${skin.value + 1} of 6`} />
          skin {skin.value + 1}/6 <span className={STATE_CLASS[skin.state]}>{STATE_TEXT[skin.state]}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch colour={hair.value.color} label={`hair colour ${hair.value.color}`} />
          {hair.value.style} <span className={STATE_CLASS[hair.state]}>{STATE_TEXT[hair.state]}</span>
        </span>
      </div>
    </li>
  );
}

export default function AppearancePage() {
  const rows = loadAppearanceRows();
  const kits = loadKitTable();

  // Players nobody has looked at first, then the most-owned ones within each group.
  const ordered = [...rows].sort((a, b) => reviewRank(b.look) - reviewRank(a.look) || b.ownership - a.ownership);
  const checked = rows.filter((r) => unverified(r.look) === 0).length;
  const withHeight = rows.filter((r) => r.look.cm.state !== "default").length;
  const stillGuessing = rows.filter((r) => [r.look.cm, r.look.skin, r.look.hair].some((t) => t.state === "default")).length;

  return (
    <>
      <Header subtitle="appearance review" />
      <Shell>
        <div className="space-y-4 pb-16 pt-4">
          <Panel className="space-y-3">
            <h1 className="text-2xl">Appearance review</h1>
            <p className="max-w-prose text-sm text-ink-soft">
              How each player looks in 3D: height, hair and skin tone. Anything marked <span className="chip chip-warn">guess</span> is a
              placeholder, <span className="chip">auto</span> came from a script, and{" "}
              <span className="chip chip-accent">checked</span> was confirmed by hand. To confirm or correct a player, press Copy, paste
              the line under <code className="font-mono text-xs">players</code> in{" "}
              <code className="font-mono text-xs">data/appearance/overrides.json</code>, change anything that is wrong and commit it.
            </p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Players", rows.length],
                ["Fully checked", checked],
                ["Height found", withHeight],
                ["Still guessing", stillGuessing],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dd className="stat text-2xl leading-none">{value}</dd>
                  <dt className="eyebrow mt-1">{label}</dt>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel className="space-y-1">
            <h2 className="text-lg">Players to check first</h2>
            {rows.length === 0 ? (
              <p className="text-sm text-ink-soft">No player snapshot yet.</p>
            ) : (
              <>
                <ul>{ordered.slice(0, FIRST_BATCH).map((r) => <PlayerRow key={r.code} r={r} />)}</ul>
                {ordered.length > FIRST_BATCH && (
                  <details>
                    <summary className="flex h-11 cursor-pointer items-center text-xs text-ink-soft">
                      Show the other {ordered.length - FIRST_BATCH} players
                    </summary>
                    <ul>{ordered.slice(FIRST_BATCH).map((r) => <PlayerRow key={r.code} r={r} />)}</ul>
                  </details>
                )}
              </>
            )}
          </Panel>

          {kits && (
            <Panel className="space-y-2">
              <h2 className="text-lg">Club kits {kits.season}</h2>
              <p className="text-xs text-ink-faint">{kits.note}</p>
              <ul data-testid="kit-list">
                {Object.keys(kits.clubs)
                  .sort()
                  .map((club) => {
                    const home = kitFor(kits, club, "DEF")!;
                    const gk = kitFor(kits, club, "GKP")!;
                    return (
                      <li key={club} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                        <span className="w-10 font-mono text-xs text-ink-soft">{club}</span>
                        <span className="flex items-center gap-1">
                          {([["shirt", home.shirt], ["shorts", home.shorts], ["socks", home.socks]] as const).map(([part, c]) => (
                            <Swatch key={part} colour={c} label={`${club} home ${part} ${c}`} />
                          ))}
                        </span>
                        <span className="text-[11px] text-ink-faint">keeper</span>
                        <span className="flex items-center gap-1">
                          {([["shirt", gk.shirt], ["shorts", gk.shorts], ["socks", gk.socks]] as const).map(([part, c]) => (
                            <Swatch key={part} colour={c} label={`${club} keeper ${part} ${c}`} />
                          ))}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </Panel>
          )}
        </div>
      </Shell>
    </>
  );
}
