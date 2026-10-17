/** The GitHub repo this app saves transfers to and rebuilds from. One place,
 * so the transfers route and the rebuild trigger can't drift apart. */
export const REPO_OWNER = "natleewhee";
export const REPO_NAME = "fplforecast";
// This repo has never had a "main" branch -- everything lives on
// claude/fpl-forecaster-build-setup-ksd7z0 (the Vercel production branch),
// so that's the correct default rather than a generic guess that 404s.
export const REPO_BRANCH = process.env.FPL_REPO_BRANCH || "claude/fpl-forecaster-build-setup-ksd7z0";
