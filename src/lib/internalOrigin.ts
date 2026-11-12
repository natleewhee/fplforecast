/** The origin the server uses to call its own routes (e.g. /api/forecast).
 *
 * Building it from the incoming request trusts the Host header, which a
 * caller controls. On Vercel production this uses the project's fixed
 * production domain instead (`VERCEL_PROJECT_PRODUCTION_URL`, set by Vercel,
 * without a scheme). Elsewhere (previews, local dev, tests) the request's own
 * origin is kept: a preview's other domains may sit behind deployment
 * protection, and locally there is nothing else to call. */
type Env = Record<string, string | undefined>;

export function internalOrigin(requestUrl: string | URL, env: Env = process.env): string {
  const prod = env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : undefined;
  if (prod) return `https://${prod.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return new URL(requestUrl).origin;
}
