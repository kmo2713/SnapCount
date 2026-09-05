/**
 * Recording the day, so it can be read back after it is over.
 *
 * Written by the sync job, never by the game-day page. That is not an
 * arbitrary split — a GET that writes fires once per open tab rather than once
 * per interval, and no dedupe key fixes a sampler whose rate depends on how
 * many browsers happen to be pointed at it. The cron writer fires on a fixed
 * cadence whether or not anyone is watching, which is the only way the x-axis
 * means "the day" rather than "when someone looked".
 *
 * The consequence worth knowing: the timeline is exactly as good as the
 * scheduled sync. If the game-day crons are not running, this table stays
 * empty and no amount of opening the page will fill it.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import { requireDb, schema } from "@/lib/db/client";
import type { GamedayData } from "@/lib/domain/gameday";

const { gamedaySnapshots } = schema;

/**
 * Sample quantisation, in minutes.
 *
 * Matches the tightest game-day cron cadence we would reasonably run. A retry
 * or a double-fire inside the same bucket collapses onto one row instead of
 * drawing the same moment twice.
 */
const BUCKET_MINUTES = 5;

/** Floors a time to the bucket grid. */
export function bucketFor(at: Date, minutes = BUCKET_MINUTES): Date {
  const ms = minutes * 60_000;
  return new Date(Math.floor(at.getTime() / ms) * ms);
}

/**
 * What one sample holds.
 *
 * Deliberately narrower than `GamedayData`: rooting interest and the full
 * standings are derived numbers that can be recomputed, and storing them would
 * multiply the payload for no gain. What cannot be recovered later is what the
 * scores actually were at this moment, which is exactly what is kept.
 */
export interface SnapshotPayload {
  generatedAt: string;
  anyLive: boolean;
  teams: Array<{
    leagueId: string;
    leagueName: string;
    teamId: string;
    isMine: boolean;
    score: number;
    remaining: number;
    yetToPlay: number;
  }>;
  games: Array<{
    eventId: string;
    shortName: string;
    state: string;
    away: string;
    home: string;
    awayScore: number | null;
    homeScore: number | null;
    /** Kept so the timeline can annotate a spike with what caused it. */
    lastPlay: string | null;
  }>;
}

export function toSnapshotPayload(data: GamedayData): SnapshotPayload {
  const teams: SnapshotPayload["teams"] = [];
  for (const m of data.matchups) {
    for (const row of m.standings) {
      teams.push({
        leagueId: m.leagueId,
        leagueName: m.leagueName,
        teamId: row.teamId,
        isMine: row.isMine,
        score: row.score,
        remaining: row.remaining,
        yetToPlay: row.yetToPlay,
      });
    }
  }

  return {
    generatedAt: data.generatedAt,
    anyLive: data.anyLive,
    teams,
    games: data.games.map((g) => ({
      eventId: g.eventId,
      shortName: g.shortName,
      state: g.state,
      away: g.away.abbr,
      home: g.home.abbr,
      awayScore: g.away.score,
      homeScore: g.home.score,
      lastPlay: g.situation?.lastPlay ?? null,
    })),
  };
}

/**
 * Records one sample, or does nothing if this bucket already has one.
 *
 * Returns whether a row was actually written, so the sync job can report it
 * honestly rather than claiming a write it did not perform.
 */
export async function writeSnapshot(
  data: GamedayData,
  at: Date = new Date(),
): Promise<{ written: boolean; bucket: Date }> {
  const db = requireDb();
  const bucket = bucketFor(at);

  const inserted = await db
    .insert(gamedaySnapshots)
    .values({
      season: data.state.season,
      week: data.viewedWeek,
      bucket,
      payload: toSnapshotPayload(data),
    })
    // The cron can fire twice, and a retried workflow re-runs the whole job.
    .onConflictDoNothing({
      target: [gamedaySnapshots.season, gamedaySnapshots.week, gamedaySnapshots.bucket],
    })
    .returning({ id: gamedaySnapshots.id });

  return { written: inserted.length > 0, bucket };
}

/** One week's samples, oldest first — the shape a timeline chart wants. */
export async function readTimeline(
  season: string,
  week: number,
): Promise<Array<{ bucket: Date; payload: SnapshotPayload }>> {
  const db = requireDb();
  const rows = await db
    .select({ bucket: gamedaySnapshots.bucket, payload: gamedaySnapshots.payload })
    .from(gamedaySnapshots)
    .where(and(eq(gamedaySnapshots.season, season), eq(gamedaySnapshots.week, week)))
    .orderBy(asc(gamedaySnapshots.bucket));

  return rows.map((r) => ({ bucket: r.bucket, payload: r.payload as SnapshotPayload }));
}

/** How many samples exist for a week — cheap enough to call from a health check. */
export async function countSnapshots(season: string, week: number): Promise<number> {
  const db = requireDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(gamedaySnapshots)
    .where(and(eq(gamedaySnapshots.season, season), eq(gamedaySnapshots.week, week)));
  return row?.n ?? 0;
}
