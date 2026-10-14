import { NextRequest, NextResponse } from "next/server";
import { photoUrls } from "@/lib/playerPhoto";

/** Serves a player's FPL headshot from our own origin. The recap image is
 * drawn on a canvas, and a canvas that has drawn another site's image can't
 * be exported (it is "tainted"), so the share image needs the photo to come
 * from here. Only a numeric photo code is accepted, so this can't be used as
 * an open proxy. */
export async function GET(request: NextRequest) {
  const code = Number(new URL(request.url).searchParams.get("code") ?? "");
  if (!Number.isInteger(code) || code <= 0 || code > 99_999_999) {
    return NextResponse.json({ error: "code must be a positive integer" }, { status: 400 });
  }
  for (const url of photoUrls(code)) {
    try {
      const res = await fetch(url, { next: { revalidate: 86_400 } });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/")) continue;
      return new NextResponse(await res.arrayBuffer(), {
        headers: { "content-type": type, "cache-control": "public, max-age=86400, s-maxage=86400" },
      });
    } catch {
      // try the next location
    }
  }
  return NextResponse.json({ error: "no photo" }, { status: 404 });
}
