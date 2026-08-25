import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db/client";
import { describeDbError } from "@/lib/db/errors";
import { env, espnCredentials, hasDatabase } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Deployment health check — is the database reachable, is the schema migrated,
 * and how stale is the cache?
 *
 * Deliberately unauthenticated but deliberately boring: it reports counts and
 * timestamps, never data or connection strings. This is the first URL to hit
 * after a deploy, and the one to check when the dashboard looks stale.
 *
 * Returns 503 when the database is configured but unusable, so uptime
 * monitoring catches a broken deploy rather than reporting a cheerful 200.
 */
export async function GET() {
  const base = {
    ok: true,
    mode: hasDatabase() ? ("cache" as const) : ("live" as const),
    sleeperUsername: env.sleeperUsername,
    season: env.season ?? "(follows Sleeper)",
    syncSecretConfigured: Boolean(env.syncSecret),
    /*
     * ESPN cookies expire on logout or a password change, and nothing announces
     * it — the leagues simply stop updating. Reporting whether they are even
     * configured turns "my ESPN teams are stale" into a one-URL diagnosis.
     * Configured is not the same as valid; `npm run espn:verify` and the sync's
     * own warnings are what prove they still work.
     */
    espn: {
      leaguesConfigured: env.espnLeagueIds.length,
      cookiesConfigured: espnCredentials() !== null,
    },
    timestamp: new Date().toISOString(),
  };

  if (!hasDatabase()) {
    return NextResponse.json({
      ...base,
      note: "No DATABASE_URL — running live against Sleeper on every request.",
    });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { ...base, ok: false, error: "Database client unavailable." },
      { status: 503 },
    );
  }

  try {
    const [counts] = await db
      .select({
        leagues: sql<number>`(select count(*) from leagues)::int`,
        teams: sql<number>`(select count(*) from teams)::int`,
        players: sql<number>`(select count(*) from players)::int`,
        rosterSlots: sql<number>`(select count(*) from roster_slots)::int`,
        matchups: sql<number>`(select count(*) from matchups)::int`,
        projections: sql<number>`(select count(*) from player_projections)::int`,
        espnAliases: sql<number>`(select count(*) from player_aliases where platform = 'espn')::int`,
      })
      .from(sql`(select 1) as _`);

    const [lastFull] = await db
      .select({
        scope: schema.syncRuns.scope,
        finishedAt: schema.syncRuns.finishedAt,
        durationMs: schema.syncRuns.durationMs,
      })
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.status, "success"))
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(1);

    const [lastError] = await db
      .select({
        scope: schema.syncRuns.scope,
        startedAt: schema.syncRuns.startedAt,
        error: schema.syncRuns.error,
      })
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.status, "error"))
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(1);

    const lastSyncAgeSeconds = lastFull?.finishedAt
      ? Math.round((Date.now() - lastFull.finishedAt.getTime()) / 1000)
      : null;

    return NextResponse.json({
      ...base,
      counts,
      lastSync: lastFull
        ? {
            scope: lastFull.scope,
            finishedAt: lastFull.finishedAt?.toISOString() ?? null,
            durationMs: lastFull.durationMs,
            ageSeconds: lastSyncAgeSeconds,
          }
        : null,
      // Only surface a failure that has not already been superseded by a
      // successful run — otherwise a long-fixed error keeps reporting itself
      // and the endpoint cries wolf.
      lastError:
        lastError &&
        (!lastFull?.finishedAt || lastError.startedAt > lastFull.finishedAt)
          ? {
              scope: lastError.scope,
              at: lastError.startedAt.toISOString(),
              error: lastError.error,
            }
          : null,
    });
  } catch (err) {
    return NextResponse.json(
      { ...base, ok: false, error: describeDbError(err) },
      { status: 503 },
    );
  }
}
