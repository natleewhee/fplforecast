/** The GitHub repo this app saves transfers to and rebuilds from. One place,
 * so the transfers route and the rebuild trigger can't drift apart. */
export const REPO_OWNER = "natleewhee";
export const REPO_NAME = "gafferfpl";
// "main" is the default and Vercel production branch (it replaced
// claude/fpl-forecaster-build-setup-ksd7z0 in Nov 2026).
export const REPO_BRANCH = process.env.FPL_REPO_BRANCH || "main";
