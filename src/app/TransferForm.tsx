"use client";

import { useState } from "react";
import type { ForecastPlayer, Player } from "@/lib/snapshots";

type Props = {
  squad: ForecastPlayer[];
  allPlayers: Player[];
  basedOnGw: number;
};

const fieldClass =
  "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-soft/60 focus:border-[var(--pitch)] focus:outline-none focus:ring-2 focus:ring-[var(--pitch-light)]/30";

export default function TransferForm({ squad, allPlayers, basedOnGw }: Props) {
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
      <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--pitch-dark)]">
        Make a transfer
      </h2>
      <p className="mt-1 text-xs text-ink-soft">
        Saves to the repo and triggers a redeploy — not budget-checked, treat it as directional
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
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line bg-white text-sm shadow-sm">
          {matches.map((p) => (
            <li
              key={p.id}
              className="cursor-pointer px-3 py-2 text-ink hover:bg-[var(--pitch-light)]/10"
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

      <label className="mt-3 block text-xs font-medium text-ink-soft">Note (optional)</label>
      <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} />

      <button
        className="mt-4 w-full rounded-lg bg-[var(--pitch-dark)] py-2 text-sm font-semibold text-white transition hover:bg-[var(--pitch)] disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft"
        disabled={outId === "" || inId === "" || status === "saving"}
        onClick={submit}
      >
        {status === "saving" ? "Saving…" : "Save transfer"}
      </button>

      {status === "saved" && (
        <p className="mt-2 text-xs font-medium text-[var(--pitch-dark)]">
          Saved. Redeploy takes a minute or two to pick it up.
        </p>
      )}
      {status === "error" && <p className="mt-2 text-xs font-medium text-[var(--fwd)]">{errorMsg}</p>}
    </div>
  );
}
