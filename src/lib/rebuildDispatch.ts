import { NO_TOKEN_HINT, refusalHint } from "./rebuildHints";
import { REPO_BRANCH, REPO_NAME, REPO_OWNER } from "./repo";

const WORKFLOW = "snapshot.yml";
export type DispatchResult = {
  /** started: a run was queued. running: one was already going (manual only). scheduled: couldn't start, waits for the daily run. */
  rebuild: "started" | "running" | "scheduled";
  hint?: string;
};

const ACTIVE = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

/** Server side only: asks GitHub Actions to rebuild the forecast now.
 * `skipIfRunning` is for the manual button, so mashing it doesn't queue a
 * pile of runs; a saved transfer always dispatches, because a run that
 * started earlier may have read the old transfers. */
export async function dispatchRebuild(opts: { skipIfRunning?: boolean } = {}): Promise<DispatchResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { rebuild: "scheduled", hint: NO_TOKEN_HINT };
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  const base = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW}`;

  if (opts.skipIfRunning) {
    try {
      const res = await fetch(`${base}/runs?per_page=5`, { headers, cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { workflow_runs?: { status: string }[] };
        if (json.workflow_runs?.some((r) => ACTIVE.has(r.status))) return { rebuild: "running" };
      }
    } catch {
      // can't tell: go ahead and try to start one
    }
  }

  try {
    const res = await fetch(`${base}/dispatches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ref: REPO_BRANCH }),
    });
    if (res.status === 204) return { rebuild: "started" };
    console.warn(`rebuild dispatch refused: ${res.status} ${await res.text()}`);
    return { rebuild: "scheduled", hint: refusalHint(res.status) };
  } catch (err) {
    console.warn(`rebuild dispatch failed: ${(err as Error).message}`);
    return { rebuild: "scheduled", hint: "Couldn't reach GitHub to start the rebuild." };
  }
}
