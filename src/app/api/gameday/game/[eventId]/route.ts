import { NextResponse } from "next/server";

import { loadGameDetail } from "@/lib/data/gameday-detail";
import { hasDatabase } from "@/lib/env";
import { callerKey, rateLimit } from "@/lib/rate-limit";

/*
 * Same reasoning as the poll endpoint: never the data cache for live data,
 * because it is stale-while-revalidate. Concurrent opens of the same game are
 * collapsed by an in-process memo in the loader instead.
 */
export const dynamic = "force-dynamic";

/**
 * One game in detail: box score, drives, scoring plays, win probability.
 *
 * Deliberately not part of the poll payload. This is ~595KB for a single game
 * against ~135KB for the entire slate, so fetching it for every game every
 * cycle would be several megabytes a poll for data nobody is looking at. It
 * loads when you open a game and not before.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  /*
   * Tighter than the poll, because a miss here is ~1.4MB of upstream fetch
   * (595KB summary + 826KB plays) and the id is enumerable, so the memo never
   * sees a second hit on a hostile pattern. Opening every game on a slate and
   * re-opening them is nowhere near this.
   */
  const limit = rateLimit(callerKey(request, "gameday-detail"), 120, 60 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Slow down — try again in ${limit.retryAfter}s.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  const { eventId } = await params;

  /*
   * Digits only and length-bounded, before this reaches an upstream URL or
   * becomes a cache key. Kept identical to the check inside the loader, so a
   * bad id is answered as a 400 here rather than escaping to the catch below
   * and being reported as a server error.
   */
  if (!/^\d{6,12}$/.test(eventId)) {
    return NextResponse.json(
      { error: "eventId must be a valid event id" },
      { status: 400 },
    );
  }

  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured; the box score cannot be marked up." },
      { status: 503 },
    );
  }

  try {
    const detail = await loadGameDetail(eventId);
    return NextResponse.json(detail, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    // Logged in full, reported in outline — this endpoint is unauthenticated,
    // and upstream errors carry hostnames and driver detail.
    console.error("[gameday] game detail failed", eventId, err);
    return NextResponse.json({ error: "Could not load this game." }, { status: 500 });
  }
}
