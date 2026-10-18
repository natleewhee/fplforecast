import { NextRequest, NextResponse } from "next/server";
import { OWNER_COOKIE, isOwnerRequest, secretMatches } from "@/lib/ownerAuth";

/** Unlocks (POST { secret }) or locks (DELETE) editing in this browser, and
 * reports whether it is currently unlocked (GET). */
export async function GET(req: NextRequest) {
  return NextResponse.json({ owner: isOwnerRequest(req), configured: Boolean(process.env.OWNER_SECRET) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const secret = typeof body?.secret === "string" ? body.secret : "";
  if (!secretMatches(secret)) {
    return NextResponse.json({ error: "That key doesn't match." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(OWNER_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // plain-http dev (a phone on the LAN) would drop a secure cookie
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(OWNER_COOKIE);
  return res;
}
