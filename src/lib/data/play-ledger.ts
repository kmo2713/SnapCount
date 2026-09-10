/**
 * The record of every play you had a stake in, and what it cost or won you.
 *
 * This is what turns "your win chance fell 18 points between 2:15 and 2:20"
 * into "because Jaxon Smith-Njigba caught a 45-yard touchdown at 2:17, which
 * was worth 11.5 against you". The snapshot timeline can only ever say *that*
 * something happened; only a play-level record can say *what*.
 *
 * ## Why it is written rather than read on demand
 *
 * Attribution needs the plays as they were, timestamped. Reading them when
 * someone asks would mean fetching ~774KB per game across thirteen games to
 * answer one question, and it would silently change answers over time: the
 * impact of a play depends on who was starting and what the league paid for it,
 * and a Tuesday trade must not rewrite what Sunday's plays were worth.
 *
 * ## Why it is affordable
 *
 * ESPN reports a game's play count for 1.7KB, and its feed paginates
 * oldest-first with near-exact ordering — measured, six of 180 plays sat one
 * position out. So each cycle asks every live game "how many plays do you have"
 * and pulls only the tail pages it is actually behind on. A finished game whose
 * plays we already hold costs one small request and no page fetches at all.
 */
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";

import { requireDb, schema } from "@/lib/db/client";
import type { ScoringSettings } from "@/lib/domain/scoring";
import {
  fetchPlayCount,
  fetchPlayPages,
  normalizeLedgerPlays,
  type LedgerPlay,
  type PlayerLeagueRole,
} from "@/lib/platforms/nfl/gamefeed";
import { PAGE_SIZE, pagesToFetch, shouldProbe } from "@/lib/platforms/nfl/play-pages";

const { gamedayPlays } = schema;

/** Postgres caps a statement's bound parameters; stay well under. */
const INSERT_CHUNK = 200;

export interface LedgerContext {
  roles: ReadonlyMap<string, PlayerLeagueRole[]>;
  canonicalId: ReadonlyMap<string, string>;
  teamAbbrById: ReadonlyMap<string, string>;
  scoringByLeague: ReadonlyMap<string, ScoringSettings | null>;
}

export interface LedgerStats {
  probed: number;
  fetched: number;
  pages: number;
  inserted: number;
  warnings: string[];
}

/** How many plays we already hold per event, for the whole week at once. */
export async function storedCounts(
  season: string,
  week: number,
): Promise<Map<string, number>> {
  const db = requireDb();
  const rows = await db
    .select({
      eventId: gamedayPlays.eventId,
      n: sql<number>`count(*)::int`,
    })
    .from(gamedayPlays)
    .where(and(eq(gamedayPlays.season, season), eq(gamedayPlays.week, week)))
    .groupBy(gamedayPlays.eventId);

  return new Map(rows.map((r) => [r.eventId, r.n]));
}

/**
 * Brings the ledger up to date for one week.
 *
 * Games are processed in sequence rather than in parallel: this runs inside a
 * cron alongside the rest of the sync, and thirteen concurrent 774KB reads
 * against an undocumented public API is how you get rate-limited off it. The
 * per-game try/catch is the important part — one game's feed failing must cost
 * that game's plays and nothing else.
 */
export async function syncPlayLedger(
  season: string,
  week: number,
  games: Array<{ eventId: string; state: string }>,
  context: LedgerContext,
): Promise<LedgerStats> {
  const db = requireDb();
  const have = await storedCounts(season, week);

  const stats: LedgerStats = {
    probed: 0,
    fetched: 0,
    pages: 0,
    inserted: 0,
    warnings: [],
  };

  for (const game of games) {
    if (!shouldProbe(game.state)) continue;

    try {
      stats.probed++;
      const remote = await fetchPlayCount(game.eventId);
      const pages = pagesToFetch(remote, have.get(game.eventId) ?? 0);
      if (pages.length === 0) continue;

      stats.fetched++;
      stats.pages += pages.length;

      const raw = await fetchPlayPages(game.eventId, pages, PAGE_SIZE);
      const plays = normalizeLedgerPlays(
        raw,
        context.roles,
        context.canonicalId,
        context.teamAbbrById,
        context.scoringByLeague,
      );
      if (plays.length === 0) continue;

      const rows = plays.map((play) => ({
        season,
        week,
        eventId: game.eventId,
        playId: play.playId,
        sequence: play.sequence,
        wallclock: play.wallclock,
        period: play.period,
        clock: play.clock,
        teamAbbr: play.teamAbbr,
        text: play.text,
        scoringPlay: play.scoringPlay,
        impact: play.impact,
      }));

      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const inserted = await db
          .insert(gamedayPlays)
          .values(rows.slice(i, i + INSERT_CHUNK))
          // The tail is re-read every cycle by design, so most of what we
          // insert is already here. The unique play id absorbs it.
          .onConflictDoNothing({ target: gamedayPlays.playId })
          .returning({ id: gamedayPlays.id });
        stats.inserted += inserted.length;
      }
    } catch (err) {
      stats.warnings.push(
        `Play ledger for event ${game.eventId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return stats;
}

/* -------------------------------------------------------------------------
   Reading it back
   ------------------------------------------------------------------------- */

/**
 * How far outside a window a play may sit and still belong to it.
 *
 * ESPN's `wallclock` runs up to ~227s out of order against feed position, so a
 * hard boundary would file a play under the wrong five minutes. Four minutes
 * covers the measured drift. The cost of the tolerance is that a play can be
 * offered as evidence for two adjacent windows, which is honest — we genuinely
 * cannot place it more precisely than this.
 */
export const WALLCLOCK_TOLERANCE_MS = 240_000;

export interface AttributedPlay {
  playId: string;
  eventId: string;
  wallclock: string;
  period: number;
  clock: string;
  teamAbbr: string | null;
  text: string;
  scoringPlay: boolean;
  /** Net fantasy points to you, in the league asked about. */
  net: number;
}

/**
 * The plays behind one window, biggest first.
 *
 * Ordered by absolute impact rather than by time because the question is
 * "what did this", and a five-minute window holds five plays on average — the
 * order they happened in is not the useful axis.
 */
export async function readAttribution(
  season: string,
  week: number,
  leagueId: string,
  from: Date,
  to: Date,
  limit = 4,
): Promise<AttributedPlay[]> {
  const db = requireDb();

  /*
   * The impact lives in jsonb keyed by league id, so the filter and the sort
   * both go through the same expression. Indexing this properly would mean an
   * expression index per league, which is not worth it: the time-range index
   * narrows a week to a handful of rows before this is ever evaluated.
   */
  const net = sql<number>`(${gamedayPlays.impact} ->> ${leagueId})::numeric`;

  const rows = await db
    .select({
      playId: gamedayPlays.playId,
      eventId: gamedayPlays.eventId,
      wallclock: gamedayPlays.wallclock,
      period: gamedayPlays.period,
      clock: gamedayPlays.clock,
      teamAbbr: gamedayPlays.teamAbbr,
      text: gamedayPlays.text,
      scoringPlay: gamedayPlays.scoringPlay,
      net,
    })
    .from(gamedayPlays)
    .where(
      and(
        eq(gamedayPlays.season, season),
        eq(gamedayPlays.week, week),
        gte(gamedayPlays.wallclock, new Date(from.getTime() - WALLCLOCK_TOLERANCE_MS)),
        lte(gamedayPlays.wallclock, to),
        /*
         * Where the ledger's breadth narrows back down. Every play in the feed
         * has a row, so that the watermark counts the same things ESPN counts —
         * which means most rows here have no stake in this league, no time, or
         * no effect on it, and none of those explains anything.
         */
        isNotNull(gamedayPlays.wallclock),
        sql`${gamedayPlays.impact} ? ${leagueId}`,
        sql`abs((${gamedayPlays.impact} ->> ${leagueId})::numeric) > 0`,
      ),
    )
    .orderBy(desc(sql`abs((${gamedayPlays.impact} ->> ${leagueId})::numeric)`))
    .limit(limit);

  return rows.map((r) => ({
    playId: r.playId,
    eventId: r.eventId,
    // Non-null by the isNotNull filter above; the cast keeps that local.
    wallclock: (r.wallclock as Date).toISOString(),
    period: r.period,
    clock: r.clock,
    teamAbbr: r.teamAbbr,
    text: r.text,
    scoringPlay: r.scoringPlay,
    net: Number(r.net),
  }));
}

/**
 * Attribution for several windows in one query round-trip.
 *
 * The timeline asks about up to five swings at once, and five sequential
 * queries inside a request path is five times the latency for no reason. The
 * windows are unioned into one range and split in memory, which is correct
 * because they are all from the same week and the row count is small.
 */
export function assignToWindows(
  plays: AttributedPlay[],
  windows: Array<{ from: Date; to: Date }>,
  perWindow: number,
): Map<number, AttributedPlay[]> {
  const out = new Map<number, AttributedPlay[]>();

  for (const window of windows) {
    const lower = window.from.getTime() - WALLCLOCK_TOLERANCE_MS;
    const upper = window.to.getTime();
    const inWindow = plays
      .filter((play) => {
        const at = Date.parse(play.wallclock);
        return at >= lower && at <= upper;
      })
      .slice(0, perWindow);
    /*
     * Keyed by the window's end, which is the sample the swing is reported at
     * — so a caller holding a swing can look up its plays without carrying the
     * window around.
     */
    out.set(window.to.getTime(), inWindow);
  }

  return out;
}

export async function readAttributionFor(
  season: string,
  week: number,
  leagueId: string,
  windows: Array<{ from: Date; to: Date }>,
  perWindow = 3,
): Promise<Map<number, AttributedPlay[]>> {
  if (windows.length === 0) return new Map();

  const earliest = new Date(
    Math.min(...windows.map((w) => w.from.getTime())) - WALLCLOCK_TOLERANCE_MS,
  );
  const latest = new Date(Math.max(...windows.map((w) => w.to.getTime())));

  /*
   * One read of the whole span, then assigned to windows locally. The limit is
   * generous rather than exact because a play can legitimately fall in two
   * adjacent windows once the tolerance is applied.
   */
  const all = await readAttribution(
    season,
    week,
    leagueId,
    earliest,
    latest,
    windows.length * perWindow * 4,
  );

  return assignToWindows(all, windows, perWindow);
}

/** The plays that decided your week, across the whole day. */
export async function readBiggestPlays(
  season: string,
  week: number,
  leagueId: string,
  limit = 6,
): Promise<AttributedPlay[]> {
  const db = requireDb();
  const [bounds] = await db
    .select({
      first: sql<Date | null>`min(${gamedayPlays.wallclock})`,
      last: sql<Date | null>`max(${gamedayPlays.wallclock})`,
    })
    .from(gamedayPlays)
    .where(and(eq(gamedayPlays.season, season), eq(gamedayPlays.week, week)));

  if (!bounds?.first || !bounds.last) return [];
  return readAttribution(
    season,
    week,
    leagueId,
    new Date(bounds.first),
    new Date(bounds.last),
    limit,
  );
}

/** Drops a week's ledger. Used by tests and by a deliberate re-import. */
export async function deletePlays(season: string, week: number): Promise<number> {
  const db = requireDb();
  const rows = await db
    .delete(gamedayPlays)
    .where(and(eq(gamedayPlays.season, season), eq(gamedayPlays.week, week)))
    .returning({ id: gamedayPlays.id });
  return rows.length;
}

export type { LedgerPlay };
