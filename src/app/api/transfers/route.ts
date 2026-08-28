import { NextRequest, NextResponse } from "next/server";

const OWNER = "natleewhee";
const REPO = "fplforecast";
const FILE_PATH = "data/overrides/transfers.json";
const BRANCH = process.env.FPL_REPO_BRANCH || "main";

type PendingTransfer = { out: number; in: number; note?: string };
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

export async function POST(req: NextRequest) {
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
    transfers.push({ out: outId, in: inId, ...(note ? { note } : {}) });

    const updated: OverridesFile = { basedOnGw, transfers };
    await putFile(updated, sha, `Transfer: out ${outId}, in ${inId}${note ? ` (${note})` : ""}`);

    return NextResponse.json({ ok: true, overrides: updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const { sha } = await getCurrentFile();
    if (!sha) return NextResponse.json({ ok: true, message: "nothing to clear" });

    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
      method: "DELETE",
      headers: githubHeaders(),
      body: JSON.stringify({ message: "Clear pending transfer overrides", sha, branch: BRANCH }),
    });
    if (!res.ok) throw new Error(`GitHub delete failed: ${res.status} ${await res.text()}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
