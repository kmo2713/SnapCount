import { NextResponse } from "next/server";

import { loadGameday } from "@/lib/data/gameday";
import { hasDatabase } from "@/lib/env";

/*
 * `force-dynamic` matches every other route here, and is deliberate rather
 * than inherited. It sets `fetchCache = 'force-no-store'` for this segment, so
 * none of the upstream calls behind `loadGameday` can land in Next's data
 * cache — which is exactly what a live scoreboard wants, because that cache is
 * stale-while-revalidate: the first request past the window is served the
 * previous scores while a refresh runs behind it. Its key also includes the
 * cookie header, so ESPN-credentialed private-league responses would be
 * persisted in a shared regional store.
 *
 * Concurrent polls are collapsed by the in-process memo in `data/gameday.ts`
 * instead, which is fresh rather than stale and keeps the credentials in
 * process. Removing `force-dynamic` to "enable caching" here would reintroduce
 * both problems.
 */
export const dynamic = "force-dynamic";

/**
 * One poll of game-day state: NFL scores, live fantasy matchups, rooting order.
 *
 * Read-only. The snapshot writer that records the day lives in
 * `/api/sync?scope=live`, driven by the game-day crons — deliberately not here.
 * A GET that writes would fire once per open tab rather than once per interval,
 * and no dedupe key can fix that.
 *
 * Unauthenticated, like the rest of this single-user app. Worth knowing what
 * that costs: one request fans out to about ten upstream calls, one of them to
 * ESPN's unauthenticated API, so anyone with the URL gets that amplification.
 * The memo bounds it — a warm instance performs at most one fan-out per 15s no
 * matter how hard it is polled. Nothing here is sensitive: public NFL scores
 * and the owner's own fantasy teams.
 */
export async function GET(request: Request) {
  if (!hasDatabase()) {
    return NextResponse.json(
      {
        error:
          "DATABASE_URL is not configured. Game day reads rosters and projections " +
          "from Postgres, so it needs a synced cache even though scores are live.",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const weekParam = url.searchParams.get("week");
  const seasonParam = url.searchParams.get("season");

  const week = weekParam ? Number(weekParam) : undefined;
  if (week != null && (!Number.isInteger(week) || week < 1 || week > 18)) {
    return NextResponse.json(
      { error: "week must be an integer between 1 and 18" },
      { status: 400 },
    );
  }

  /*
   * Season is validated as strictly as week, for two reasons that are easy to
   * miss because neither is about this handler. It is part of the in-process
   * memo's key, so an unconstrained value lets a caller mint unlimited distinct
   * keys and defeat the collapsing that bounds our upstream fan-out. And it is
   * interpolated into ESPN URLs that carry account cookies, where the only
   * thing currently stopping a strange value is that it happens to match no
   * league row — an accident of data shape, not a control.
   */
  if (seasonParam != null && !/^\d{4}$/.test(seasonParam)) {
    return NextResponse.json(
      { error: "season must be a four-digit year" },
      { status: 400 },
    );
  }

  try {
    const data = await loadGameday({ week, season: seasonParam ?? undefined });
    return NextResponse.json(data, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    // Logged in full, reported in outline: this endpoint is unauthenticated,
    // and driver errors carry internal hostnames and database names.
    console.error("[gameday] load failed", err);
    return NextResponse.json(
      { error: "Could not assemble game day. Check the server logs." },
      { status: 500 },
    );
  }
}
