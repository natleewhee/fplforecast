import { NextRequest, NextResponse } from "next/server";
import { resolveTeamId, OWNER_TEAM_ID } from "@/lib/teamId";
import { sameTransfer, type PendingTransfer } from "@/lib/transfers";

const OWNER = "natleewhee";
const REPO = "fplforecast";
const FILE_PATH = "data/overrides/transfers.json";
// This repo has never had a "main" branch -- everything lives on
// claude/fpl-forecaster-build-setup-ksd7z0 (the Vercel production branch),
// so that's the correct default rather than a generic guess that 404s.
const BRANCH = process.env.FPL_REPO_BRANCH || "claude/fpl-forecaster-build-setup-ksd7z0";

type OverridesFile = { basedOnGw: number; transfers: PendingTransfer[] };

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set — add a repo-scoped token to this project's Vercel env vars"
    );
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

async function getCurrentFile(): Promise<{ sha: string | null; data: OverridesFile | null }> {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
    { headers: githubHeaders(), cache: "no-store" }
  );
  if (res.status === 404) return { sha: null, data: null };
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const content = Buffer.from(json.content, "base64").toString("utf-8");
  return { sha: json.sha, data: JSON.parse(content) };
}

async function putFile(content: OverridesFile, sha: string | null, message: string) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
    method: "PUT",
    headers: githubHeaders(),
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub write failed: ${res.status} ${await res.text()}`);
}

type Rebuild = "started" | "scheduled" | "none";

/** Asks GitHub Actions to rebuild the forecast now, so a saved change shows up
 * in minutes instead of at the next 03:00 UTC run. Best effort: the token may
 * lack Actions permission, in which case the daily run picks the change up. */
async function triggerRebuild(): Promise<Rebuild> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/snapshot.yml/dispatches`,
      { method: "POST", headers: githubHeaders(), body: JSON.stringify({ ref: BRANCH }) },
    );
    if (res.status === 204) return "started";
    console.warn(`rebuild dispatch refused: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.warn(`rebuild dispatch failed: ${(err as Error).message}`);
  }
  return "scheduled";
}

export async function POST(req: NextRequest) {
  const teamId = resolveTeamId(req.cookies);
  if (teamId !== OWNER_TEAM_ID) {
    // This route writes straight to this repo (a git commit + redeploy) --
    // never on behalf of a guest looking up someone else's team, however
    // that out/in pair got into the request body.
    return NextResponse.json(
      { error: "Saving a transfer is only available for this app's own team." },
      { status: 403 },
    );
  }
  try {
    const body = await req.json();
    const outId = Number(body.outId);
    const inId = Number(body.inId);
    const basedOnGw = Number(body.basedOnGw);
    const note = typeof body.note === "string" ? body.note.slice(0, 200) : undefined;

    if (!Number.isFinite(outId) || !Number.isFinite(inId) || !Number.isFinite(basedOnGw)) {
      return NextResponse.json({ error: "outId, inId and basedOnGw are required numbers" }, { status: 400 });
    }

    const { sha, data } = await getCurrentFile();
    const isStale = !data || data.basedOnGw !== basedOnGw;
    const transfers: PendingTransfer[] = isStale ? [] : [...data.transfers];
    const incoming: PendingTransfer = { out: outId, in: inId, ...(note ? { note } : {}) };
    // a repeated click (or a retry) of the same swap must not write a second copy
    if (transfers.some((t) => sameTransfer(t, incoming))) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        rebuild: "none" satisfies Rebuild,
        overrides: { basedOnGw, transfers },
      });
    }
    transfers.push(incoming);

    const updated: OverridesFile = { basedOnGw, transfers };
    await putFile(updated, sha, `Transfer: out ${outId}, in ${inId}${note ? ` (${note})` : ""}`);
    const rebuild = await triggerRebuild();

    return NextResponse.json({ ok: true, rebuild, overrides: updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const teamId = resolveTeamId(req.cookies);
  if (teamId !== OWNER_TEAM_ID) {
    return NextResponse.json(
      { error: "Clearing transfers is only available for this app's own team." },
      { status: 403 },
    );
  }
  try {
    // With { outId, inId } remove just that transfer; with no body clear them all.
    const body = await req.json().catch(() => null);
    const target =
      body && Number.isFinite(Number(body.outId)) && Number.isFinite(Number(body.inId))
        ? { out: Number(body.outId), in: Number(body.inId) }
        : null;

    const { sha, data } = await getCurrentFile();
    if (!sha || !data) return NextResponse.json({ ok: true, message: "nothing to clear", overrides: null });

    const remaining = target ? data.transfers.filter((t) => !sameTransfer(t, target)) : [];
    if (target && remaining.length === data.transfers.length) {
      return NextResponse.json({ ok: true, message: "not found", overrides: data, rebuild: "none" satisfies Rebuild });
    }

    if (remaining.length > 0) {
      const updated: OverridesFile = { basedOnGw: data.basedOnGw, transfers: remaining };
      await putFile(updated, sha, `Remove pending transfer: out ${target!.out}, in ${target!.in}`);
      return NextResponse.json({ ok: true, rebuild: await triggerRebuild(), overrides: updated });
    }

    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
      method: "DELETE",
      headers: githubHeaders(),
      body: JSON.stringify({ message: "Clear pending transfer overrides", sha, branch: BRANCH }),
    });
    if (!res.ok) throw new Error(`GitHub delete failed: ${res.status} ${await res.text()}`);
    return NextResponse.json({ ok: true, rebuild: await triggerRebuild(), overrides: null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
