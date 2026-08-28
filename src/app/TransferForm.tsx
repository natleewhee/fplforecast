"use client";

import { useState } from "react";
import type { ForecastPlayer, Player } from "@/lib/snapshots";

type Props = {
  squad: ForecastPlayer[];
  allPlayers: Player[];
  basedOnGw: number;
};

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
    <div className="mt-4 rounded border border-neutral-200 p-3">
      <h2 className="text-sm font-semibold text-neutral-600">Make a transfer</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Saves to the repo and triggers a redeploy — not budget-checked, treat it as directional
      </p>

      <label className="mt-2 block text-xs text-neutral-500">Out</label>
      <select
        className="mt-1 w-full rounded border border-neutral-300 p-1.5 text-sm"
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

      <label className="mt-2 block text-xs text-neutral-500">In</label>
      <input
        className="mt-1 w-full rounded border border-neutral-300 p-1.5 text-sm"
        placeholder="Search player name…"
        value={inQuery}
        onChange={(e) => {
          setInQuery(e.target.value);
          setInId("");
        }}
      />
      {matches.length > 0 && inId === "" && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-neutral-200 text-sm">
          {matches.map((p) => (
            <li
              key={p.id}
              className="cursor-pointer px-2 py-1 hover:bg-neutral-100"
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

      <label className="mt-2 block text-xs text-neutral-500">Note (optional)</label>
      <input
        className="mt-1 w-full rounded border border-neutral-300 p-1.5 text-sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <button
        className="mt-3 w-full rounded bg-neutral-800 py-1.5 text-sm text-white disabled:opacity-40"
        disabled={outId === "" || inId === "" || status === "saving"}
        onClick={submit}
      >
        {status === "saving" ? "Saving…" : "Save transfer"}
      </button>

      {status === "saved" && (
        <p className="mt-2 text-xs text-green-600">
          Saved. Redeploy takes a minute or two to pick it up.
        </p>
      )}
      {status === "error" && <p className="mt-2 text-xs text-red-600">{errorMsg}</p>}
    </div>
  );
}
