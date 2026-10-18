import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { OWNER_TEAM_ID, resolveTeamId } from "./teamId.ts";

/** The routes that write to this repo or spend its GitHub Actions minutes
 * (/api/transfers, /api/rebuild) used to treat "no team cookie" as the owner,
 * so any visitor could call them. They now need the OWNER_SECRET setting,
 * sent back as an httpOnly cookie after one unlock. With no OWNER_SECRET set
 * they refuse everyone: locked is the safe default. */

export const OWNER_COOKIE = "gaffer_owner";

const digest = (value: string) => createHash("sha256").update(value).digest();

export function secretMatches(given: string | undefined | null, secret = process.env.OWNER_SECRET): boolean {
  if (!secret || !given) return false;
  return timingSafeEqual(digest(given), digest(secret));
}

export function isOwnerRequest(req: Pick<NextRequest, "cookies">): boolean {
  return (
    resolveTeamId(req.cookies) === OWNER_TEAM_ID && secretMatches(req.cookies.get(OWNER_COOKIE)?.value)
  );
}

export const LOCKED_BODY = {
  error: "Editing is locked. Enter the owner key to unlock it.",
  locked: true,
} as const;
