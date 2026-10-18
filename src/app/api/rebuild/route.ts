import { NextRequest, NextResponse } from "next/server";
import { LOCKED_BODY, isOwnerRequest } from "@/lib/ownerAuth";
import { dispatchRebuild } from "@/lib/rebuildDispatch";

/** The "Rebuild now" button: starts the forecast rebuild (data refresh plus
 * the optimiser) instead of waiting for the daily 03:00 UTC run. Owner only
 * (see ownerAuth.ts), like /api/transfers: it spends this repo's GitHub Actions minutes. */
export async function POST(req: NextRequest) {
  if (!isOwnerRequest(req)) return NextResponse.json(LOCKED_BODY, { status: 401 });
  const result = await dispatchRebuild({ skipIfRunning: true });
  return NextResponse.json({ ok: true, ...result });
}
