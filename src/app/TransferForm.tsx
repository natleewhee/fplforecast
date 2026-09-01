"use client";

import { useState } from "react";
import type { ForecastPlayer, Player } from "@/lib/snapshots";

type Props = {
  squad: ForecastPlayer[];
  allPlayers: Player[];
  basedOnGw: number;
  bank: number; // £m in the bank
};

const fieldClass =
  "mt-1 w-full rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]";

export default function TransferForm({ squad, allPlayers, basedOnGw, bank }: Props) {
  const [outId, setOutId] = useState<number | "">("");
  const [inQuery, setInQuery] = useState("");
  const [inId, setInId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const squadIds = new Set(squad.map((p) => p.id));
  const matches =
    inQuery.length >= 2
      ? allPlayers.filter((p) => !squadIds.has(p.id) && p.webName.toLowerCase().includes(inQuery.toLowerCase())).slice(0, 8)
      : [];

  const outPlayer = outId === "" ? null : squad.find((p) => p.id === outId) ?? null;
  const inPlayer = inId === "" ? null : allPlayers.find((p) => p.id === inId) ?? null;
  const sellPrice = outPlayer?.sellPrice ?? outPlayer?.price ?? null;
  // Sale of the outgoing player frees up their (assumed) sell price on top of
  // the bank; the incoming player costs their listed price.
  const remaining =
    sellPrice != null && inPlayer != null
      ? bank + sellPrice - inPlayer.priceMillions
      : null;

  async function submit() {
    if (outId === "" || inId === "") return;
    setStatus("saving");
    setErrorMsg("");
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outId, inId, note, basedOnGw }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setErrorMsg((err as Error).message);
    }
  }

  return (
    <div>
      <h2 className="font-mono text-[13px] font-bold tracking-[0.12em] text-ink">
        MAKE A TRANSFER
      </h2>
      <p className="mt-1 text-xs text-ink-soft">
        Saves to the repo and triggers a redeploy. Bank{" "}
        <span className="font-semibold text-ink tabular-nums">£{bank.toFixed(1)}m</span> · sell prices
        assume each player was bought at today&apos;s price.
      </p>

      <label className="mt-3 block text-xs font-medium text-ink-soft">Out</label>
      <select
        className={fieldClass}
        value={outId}
        onChange={(e) => setOutId(e.target.value ? Number(e.target.value) : "")}
      >
        <option value="">Select player to transfer out…</option>
        {squad.map((p) => (
          <option key={p.id} value={p.id}>
            {p.webName} ({p.position})
          </option>
        ))}
      </select>

      <label className="mt-3 block text-xs font-medium text-ink-soft">In</label>
      <input
        className={fieldClass}
        placeholder="Search player name…"
        value={inQuery}
        onChange={(e) => {
          setInQuery(e.target.value);
          setInId("");
        }}
      />
      {matches.length > 0 && inId === "" && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line bg-[var(--bg-2)] text-sm shadow-xl">
          {matches.map((p) => (
            <li
              key={p.id}
              className="cursor-pointer px-3 py-2 text-ink hover:bg-white/[0.06]"
              onClick={() => {
                setInId(p.id);
                setInQuery(p.webName);
              }}
            >
              {p.webName} ({p.position}, {p.team}) — £{p.priceMillions.toFixed(1)}m
            </li>
          ))}
        </ul>
      )}

      {remaining != null && (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${
            remaining < -1e-6
              ? "border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]"
              : "border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]"
          }`}
        >
          {remaining < -1e-6
            ? `Over budget by £${Math.abs(remaining).toFixed(1)}m`
            : `£${remaining.toFixed(1)}m left after this transfer`}
          {sellPrice != null && (
            <span className="text-ink-soft">
              {" "}
              (sell {outPlayer?.webName} for ~£{sellPrice.toFixed(1)}m)
            </span>
          )}
        </p>
      )}

      <label className="mt-3 block text-xs font-medium text-ink-soft">Note (optional)</label>
      <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} />

      <button
        className="mt-4 w-full rounded-lg bg-gradient-to-b from-[var(--accent)] to-[#23c78c] py-2 text-sm font-bold text-black shadow-[0_0_20px_var(--accent-glow)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-none disabled:bg-white/5 disabled:text-ink-faint disabled:shadow-none"
        disabled={outId === "" || inId === "" || status === "saving"}
        onClick={submit}
      >
        {status === "saving" ? "Saving…" : "Save transfer"}
      </button>

      {status === "saved" && (
        <p className="mt-2 text-xs font-medium text-[var(--accent)]">
          Saved. Redeploy takes a minute or two to pick it up.
        </p>
      )}
      {status === "error" && (
        <p className="mt-2 text-xs font-medium text-[var(--danger)]">{errorMsg}</p>
      )}
    </div>
  );
}
