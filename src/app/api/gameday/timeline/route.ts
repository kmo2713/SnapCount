import { NextResponse } from "next/server";

import { readTimeline } from "@/lib/data/gameday-snapshot";
import { env, hasDatabase } from "@/lib/env";
import { sleeper } from "@/lib/platforms/sleeper/client";
import { resolveViewedWeek } from "@/lib/platforms/sleeper/fetch";

export const dynamic = "force-dynamic";

/**
 * The day, as recorded.
 *
 * Reads only — the snapshots are written by the scheduled sync, never here.
 * Flattened server-side into the row-per-sample shape a chart wants, so the
 * browser is not handed the raw payloads to pivot.
 */
export async function GET(request: Request) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  }

  const url = new URL(request.url);
  const weekParam = url.searchParams.get("week");
  const parsed = weekParam ? Number(weekParam) : undefined;

  if (parsed != null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 18)) {
    return NextResponse.json(
      { error: "week must be an integer between 1 and 18" },
      { status: 400 },
    );
  }

  try {
    const state = await sleeper.getState();
    const season = env.season ?? state?.league_season ?? state?.season ?? "";
    const week = parsed ?? (state ? resolveViewedWeek(state) : 1);

    /*
     * Bounded. A full Sunday is roughly 720 multi-KB samples and this endpoint
     * is unauthenticated, so an unbounded read is megabytes out of Postgres
     * pivoted in the request path. More than a day of points is not a chart
     * anyone can read anyway, and the newest are the ones that matter.
     */
    const samples = (await readTimeline(season, week)).slice(-1000);

    /*
     * One row per sample, one column per league, tracing your own team. Team
     * rows carry every team in the league; only `isMine` is charted, because
     * nine leagues times twelve teams is a hundred lines nobody can read.
     */
    const leagues = new Set<string>();
    const rows = samples.map((sample) => {
      const row: Record<string, string | number> = {
        label: sample.bucket.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }),
      };
      for (const team of sample.payload.teams) {
        if (!team.isMine) continue;
        leagues.add(team.leagueName);
        row[team.leagueName] = team.score;
      }
      return row;
    });

    return NextResponse.json(
      { leagues: [...leagues], rows },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[gameday] timeline failed", err);
    return NextResponse.json({ error: "Could not load the timeline." }, { status: 500 });
  }
}
