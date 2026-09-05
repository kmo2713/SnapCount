import { NextResponse } from "next/server";

import { syncAll, syncAllLiveScores, type SyncResult } from "@/lib/data/sync";
import { env, hasDatabase } from "@/lib/env";

export const dynamic = "force-dynamic";
/** A full sync of 7 leagues takes well over the default limit. */
export const maxDuration = 300;

/**
 * Triggers a sync — pull from Sleeper, write into Postgres.
 *
 * Two scopes, because they belong on very different schedules:
 *
 *   ?scope=live  Current week's matchup totals and per-player points only.
 *                One endpoint per league, ~1s. This is the game-day job; run it
 *                every few minutes while games are being played.
 *
 *   ?scope=full  Everything: leagues, rosters, matchups, drafts, projections,
 *                trending. ~7s. A few times a day is plenty — rosters and
 *                drafts do not move mid-game. This is the default.
 *
 * Guarded by SYNC_SECRET so the endpoint is not an open button for anyone who
 * finds the deployment. Sleeper needs no credentials, but a sync still costs
 * real API calls and database writes.
 *
 * Both verbs are supported on purpose: POST for manual/scripted triggers, GET
 * for Vercel Cron, which issues a GET carrying `Authorization: Bearer
 * $CRON_SECRET`. Set CRON_SECRET to the same value as SYNC_SECRET so the
 * scheduled job authenticates.
 */
async function handle(request: Request): Promise<NextResponse> {
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured; nothing to sync into." },
      { status: 503 },
    );
  }

  if (!env.syncSecret) {
    return NextResponse.json(
      { error: "SYNC_SECRET is not set. Refusing to expose an unauthenticated sync." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("secret");

  if (provided !== env.syncSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope = url.searchParams.get("scope") ?? "full";
  if (scope !== "full" && scope !== "live") {
    return NextResponse.json(
      { error: `Unknown scope "${scope}". Use "full" or "live".` },
      { status: 400 },
    );
  }

  const started = Date.now();

  try {
    let results: SyncResult[];

    if (scope === "live") {
      const weekParam = url.searchParams.get("week");
      const week = weekParam ? Number(weekParam) : undefined;
      if (week != null && (!Number.isInteger(week) || week < 1 || week > 18)) {
        return NextResponse.json(
          { error: "week must be an integer between 1 and 18" },
          { status: 400 },
        );
      }
      results = await syncAllLiveScores(undefined, week);
    } else {
      // Opt in to the expensive jobs explicitly; both otherwise run only when
      // their tables are empty.
      results = await syncAll({
        includePlayers: url.searchParams.get("players") === "1",
        includeSchedule: url.searchParams.get("schedule") === "1",
      });
    }

    return NextResponse.json({
      ok: true,
      scope,
      totalMs: Date.now() - started,
      results: results.map((r) => ({
        scope: r.scope,
        stats: r.stats,
        warnings: r.warnings,
        durationMs: r.durationMs,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        scope,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
