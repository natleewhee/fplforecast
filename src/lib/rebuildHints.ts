/** Plain-English reasons GitHub refuses to start a forecast rebuild. When a
 * rebuild can't start, the squad only updates at the next daily run, so the
 * app says why (and what to change) instead of silently waiting. */
export function refusalHint(status: number): string {
  if (status === 401) {
    return "GitHub rejected the app's token. Create a new one and update GITHUB_TOKEN in Vercel.";
  }
  if (status === 403 || status === 404) {
    return "The app's GitHub token can't start rebuilds. Give it the 'Actions: Read and write' permission, then redeploy.";
  }
  if (status === 422) {
    return "GitHub won't start the snapshot workflow by hand on this branch.";
  }
  return `GitHub refused to start the rebuild (HTTP ${status}).`;
}

export const NO_TOKEN_HINT = "GITHUB_TOKEN isn't set on the server, so the app can't start rebuilds.";
