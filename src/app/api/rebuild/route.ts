import { NextRequest, NextResponse } from "next/server";
import { OWNER_TEAM_ID, resolveTeamId } from "@/lib/teamId";
import { dispatchRebuild } from "@/lib/rebuildDispatch";

/** The "Rebuild now" button: starts the forecast rebuild (data refresh plus
 * the optimiser) instead of waiting for the daily 03:00 UTC run. Owner only,
 * like /api/transfers: it spends this repo's GitHub Actions minutes. */
export async function POST(req: NextRequest) {
  if (resolveTeamId(req.cookies) !== OWNER_TEAM_ID) {
    return NextResponse.json({ error: "Only the app's own team can start a rebuild." }, { status: 403 });
  }
  const result = await dispatchRebuild({ skipIfRunning: true });
  return NextResponse.json({ ok: true, ...result });
}
