/**
 * Sync jobs: pull from the platform APIs, write into Postgres.
 *
 * Everything here is idempotent — each job upserts on the natural key, so
 * re-running a sync is always safe and never duplicates rows. Rows that
 * disappear upstream (a dropped player, a traded-away roster slot) are deleted
 * within the scope being rewritten, so the cache cannot accumulate ghosts.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { requireDb, schema } from "@/lib/db/client";
import { env } from "@/lib/env";
import { espn } from "@/lib/platforms/espn/client";
import {
  buildEspnCrosswalk,
  espnOnlyPlayerId,
  type CanonicalPlayer,
} from "@/lib/platforms/espn/players";
import { fetchByeWeeks } from "@/lib/platforms/nfl/schedule";
import { syncEspnLeaguesInner, type SyncEspnOptions } from "./sync-espn";
import { sleeper } from "@/lib/platforms/sleeper/client";
import {
  fetchLeagueBundle,
  getPlayerMap,
  resolveViewedWeek,
} from "@/lib/platforms/sleeper/fetch";
import { combinePoints, teamNameFor } from "@/lib/platforms/sleeper/normalize";
import type { SleeperPlayer } from "@/lib/platforms/sleeper/types";

const {
  accounts,
  draftPicks,
  drafts,
  leagueMembers,
  leagues,
  matchupPlayers,
  matchups,
  nflState,
  nflTeams,
  playerAliases,
  playerProjections,
  players,
  rosterSlots,
  syncRuns,
  teams,
  trendingPlayers,
} = schema;

/** Postgres caps a statement at 65535 bound parameters; stay well under. */
const CHUNK_SIZE = 500;

function chunk<T>(rows: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const num = (n: number | null | undefined): string | null =>
  n == null ? null : n.toFixed(2);

export interface SyncResult {
  scope: string;
  stats: Record<string, number>;
  warnings: string[];
  durationMs: number;
}

/** Wraps a job so every run is recorded in sync_runs, success or failure. */
async function recorded(
  scope: string,
  platform: "sleeper" | "yahoo" | "espn" | null,
  job: () => Promise<{ stats: Record<string, number>; warnings: string[] }>,
): Promise<SyncResult> {
  const db = requireDb();
  const startedAt = new Date();
  const [run] = await db
    .insert(syncRuns)
    .values({ scope, platform, status: "running", startedAt })
    .returning({ id: syncRuns.id });

  try {
    const { stats, warnings } = await job();
    const durationMs = Date.now() - startedAt.getTime();
    await db
      .update(syncRuns)
      .set({
        status: "success",
        finishedAt: new Date(),
        durationMs,
        stats: { ...stats, warnings: warnings.length },
      })
      .where(eq(syncRuns.id, run.id));
    return { scope, stats, warnings, durationMs };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({
        status: "error",
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}

/* -------------------------------------------------------------------------
   Players
   ------------------------------------------------------------------------- */

function toPlayerRow(p: SleeperPlayer) {
  const fullName =
    p.full_name?.trim() ||
    [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
    p.player_id;

  return {
    id: p.player_id,
    sleeperId: p.player_id,
    espnId: p.espn_id != null ? String(p.espn_id) : null,
    yahooId: p.yahoo_id != null ? String(p.yahoo_id) : null,
    gsisId: p.gsis_id ?? null,
    sportradarId: p.sportradar_id ?? null,
    fullName,
    firstName: p.first_name ?? null,
    lastName: p.last_name ?? null,
    searchName: p.search_full_name ?? fullName.toLowerCase().replace(/[^a-z]/g, ""),
    position: p.position ?? p.fantasy_positions?.[0] ?? null,
    fantasyPositions: p.fantasy_positions ?? null,
    nflTeam: p.team ?? null,
    number: p.number ?? null,
    age: p.age ?? null,
    yearsExp: p.years_exp ?? null,
    college: p.college ?? null,
    height: p.height ?? null,
    weight: p.weight ?? null,
    status: p.status ?? null,
    injuryStatus: p.injury_status ?? null,
    injuryBodyPart: p.injury_body_part ?? null,
    injuryNotes: p.injury_notes ?? null,
    practiceParticipation: p.practice_participation ?? null,
    depthChartPosition: p.depth_chart_position ?? null,
    depthChartOrder: p.depth_chart_order ?? null,
    searchRank: p.search_rank ?? null,
    active: p.active ?? true,
    newsUpdated: p.news_updated ? new Date(p.news_updated) : null,
    updatedAt: new Date(),
  };
}

/**
 * Refreshes the canonical player dimension from Sleeper's full dump.
 * ~12k rows, ~15MB — run this daily at most, never on a request path.
 */
export async function syncPlayers(force = false): Promise<SyncResult> {
  return recorded("players", "sleeper", async () => {
    const db = requireDb();
    const map = await getPlayerMap(force);
    const rows = Object.values(map).map(toPlayerRow);

    for (const batch of chunk(rows)) {
      await db
        .insert(players)
        .values(batch)
        .onConflictDoUpdate({
          target: players.id,
          set: {
            espnId: sql`excluded.espn_id`,
            yahooId: sql`excluded.yahoo_id`,
            gsisId: sql`excluded.gsis_id`,
            sportradarId: sql`excluded.sportradar_id`,
            fullName: sql`excluded.full_name`,
            firstName: sql`excluded.first_name`,
            lastName: sql`excluded.last_name`,
            searchName: sql`excluded.search_name`,
            position: sql`excluded.position`,
            fantasyPositions: sql`excluded.fantasy_positions`,
            nflTeam: sql`excluded.nfl_team`,
            number: sql`excluded.number`,
            age: sql`excluded.age`,
            yearsExp: sql`excluded.years_exp`,
            college: sql`excluded.college`,
            height: sql`excluded.height`,
            weight: sql`excluded.weight`,
            status: sql`excluded.status`,
            injuryStatus: sql`excluded.injury_status`,
            injuryBodyPart: sql`excluded.injury_body_part`,
            injuryNotes: sql`excluded.injury_notes`,
            practiceParticipation: sql`excluded.practice_participation`,
            depthChartPosition: sql`excluded.depth_chart_position`,
            depthChartOrder: sql`excluded.depth_chart_order`,
            searchRank: sql`excluded.search_rank`,
            active: sql`excluded.active`,
            newsUpdated: sql`excluded.news_updated`,
            updatedAt: sql`now()`,
          },
        });
    }

    // Sleeper ids map onto canonical ids 1:1. Yahoo/ESPN aliases get written
    // by their own integrations later, using espnId/yahooId to resolve.
    const aliasRows = rows.map((r) => ({
      platform: "sleeper" as const,
      platformPlayerId: r.id,
      playerId: r.id,
    }));
    for (const batch of chunk(aliasRows)) {
      await db.insert(playerAliases).values(batch).onConflictDoNothing();
    }

    return { stats: { players: rows.length }, warnings: [] };
  });
}

/**
 * Resolves ESPN's player universe onto our canonical players and stores the
 * result in `player_aliases`.
 *
 * This has to exist before any ESPN league can be read, because an ESPN roster
 * is a list of ESPN player ids and nothing else. The obvious shortcut —
 * trusting the `espn_id` Sleeper hands us — covers barely a third of the
 * players who matter and none of the team defenses, so the crosswalk earns its
 * keep by matching on name and NFL team as well.
 *
 * Rows are updated rather than left alone on conflict: improving the matcher
 * should correct existing mappings on the next run, not leave the old ones in
 * place forever.
 */
export async function syncEspnAliases(season: string): Promise<SyncResult> {
  return recorded("espn-ids", "espn", async () => {
    const db = requireDb();

    const [universe, proTeams] = await Promise.all([
      espn.getPlayerUniverse(season),
      espn.getProTeams(season),
    ]);

    const canonical = (await db
      .select({
        id: players.id,
        fullName: players.fullName,
        position: players.position,
        nflTeam: players.nflTeam,
        espnId: players.espnId,
      })
      .from(players)) as CanonicalPlayer[];

    if (canonical.length === 0) {
      return {
        stats: {
          espnPlayers: universe.length,
          matched: 0,
          espnOnly: 0,
          unmatched: universe.length,
          notable: 0,
        },
        warnings: ["No canonical players yet — run the player sync first."],
      };
    }

    const result = buildEspnCrosswalk({
      espnPlayers: universe,
      canonical,
      proTeams,
    });

    /*
     * Head coaches and team QBs have no Sleeper counterpart, so they get
     * canonical rows of their own before being aliased — otherwise a league
     * that starts a head coach every week renders that slot permanently empty.
     * Ids are namespaced `espn-<id>` so they cannot collide with Sleeper's.
     */
    for (const batch of chunk(
      result.espnOnly.map((p) => ({
        id: espnOnlyPlayerId(p.espnPlayerId),
        espnId: p.espnPlayerId,
        fullName: p.name,
        searchName: p.name.toLowerCase().replace(/[^a-z0-9]/g, ""),
        position: p.position,
        fantasyPositions: [p.position],
        nflTeam: p.nflTeam || null,
        active: true,
      })),
    )) {
      await db
        .insert(players)
        .values(batch)
        .onConflictDoUpdate({
          target: players.id,
          set: {
            fullName: sql`excluded.full_name`,
            nflTeam: sql`excluded.nfl_team`,
            updatedAt: sql`now()`,
          },
        });
    }

    const aliasRows = [
      ...result.matches.map((m) => ({
        platformPlayerId: m.espnPlayerId,
        playerId: m.playerId,
      })),
      ...result.espnOnly.map((p) => ({
        platformPlayerId: p.espnPlayerId,
        playerId: espnOnlyPlayerId(p.espnPlayerId),
      })),
    ];

    for (const batch of chunk(
      aliasRows.map((m) => ({
        platform: "espn" as const,
        platformPlayerId: m.platformPlayerId,
        playerId: m.playerId,
      })),
    )) {
      await db
        .insert(playerAliases)
        .values(batch)
        .onConflictDoUpdate({
          target: [playerAliases.platform, playerAliases.platformPlayerId],
          set: { playerId: sql`excluded.player_id`, updatedAt: sql`now()` },
        });
    }

    // Only misses anyone actually rosters are worth a warning. The universe
    // carries thousands of retired players Sleeper has long since dropped.
    const notable = result.unmatched
      .filter((u) => u.fantasyRelevant && u.percentOwned >= 1)
      .sort((a, b) => b.percentOwned - a.percentOwned);

    const warnings = notable.slice(0, 10).map(
      (u) =>
        `No canonical player for ESPN ${u.position} ${u.name} (${u.nflTeam || "FA"}), ` +
        `rostered in ${u.percentOwned.toFixed(1)}% of leagues — ${u.reason}.`,
    );
    if (notable.length > warnings.length) {
      warnings.push(`…and ${notable.length - warnings.length} more unmatched.`);
    }

    return {
      stats: {
        espnPlayers: universe.length,
        matched: result.matches.length,
        espnOnly: result.espnOnly.length,
        unmatched: result.unmatched.length,
        notable: notable.length,
      },
      warnings,
    };
  });
}

/**
 * ESPN leagues, written into the same tables as the Sleeper ones.
 *
 * The work lives in ./sync-espn; this wrapper exists so the job is recorded in
 * `sync_runs` alongside every other scope.
 */
export async function syncEspnLeagues(
  options: SyncEspnOptions = {},
): Promise<SyncResult> {
  return recorded("espn", "espn", () => syncEspnLeaguesInner(options));
}

/* -------------------------------------------------------------------------
   NFL state + schedule
   ------------------------------------------------------------------------- */

export async function syncNflState(): Promise<SyncResult> {
  return recorded("state", "sleeper", async () => {
    const db = requireDb();
    const state = await sleeper.getState();
    if (!state) throw new Error("Sleeper returned no NFL state");

    await db
      .insert(nflState)
      .values({
        id: "nfl",
        season: state.season,
        seasonType: state.season_type,
        week: state.week,
        displayWeek: state.display_week,
        leagueSeason: state.league_season,
        previousSeason: state.previous_season,
        seasonStartDate: state.season_start_date,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: nflState.id,
        set: {
          season: sql`excluded.season`,
          seasonType: sql`excluded.season_type`,
          week: sql`excluded.week`,
          displayWeek: sql`excluded.display_week`,
          leagueSeason: sql`excluded.league_season`,
          previousSeason: sql`excluded.previous_season`,
          seasonStartDate: sql`excluded.season_start_date`,
          updatedAt: sql`now()`,
        },
      });

    return { stats: { week: state.week }, warnings: [] };
  });
}

/** Pulls bye weeks from ESPN's public scoreboard into nfl_teams. */
export async function syncSchedule(season: string): Promise<SyncResult> {
  return recorded("schedule", null, async () => {
    const db = requireDb();
    const byes = await fetchByeWeeks(season);
    const rows = Object.entries(byes).map(([abbr, byeWeek]) => ({
      season,
      abbr,
      byeWeek,
      updatedAt: new Date(),
    }));

    if (rows.length === 0) {
      return {
        stats: { teams: 0 },
        warnings: [`ESPN returned no bye-week data for ${season}.`],
      };
    }

    await db
      .insert(nflTeams)
      .values(rows)
      .onConflictDoUpdate({
        target: [nflTeams.season, nflTeams.abbr],
        set: { byeWeek: sql`excluded.bye_week`, updatedAt: sql`now()` },
      });

    return { stats: { teams: rows.length }, warnings: [] };
  });
}

/* -------------------------------------------------------------------------
   Live scores
   ------------------------------------------------------------------------- */

/**
 * The game-day fast path: refresh only what actually moves while games are
 * being played — matchup totals and per-player points for the current week.
 *
 * A full `syncAll` re-pulls rosters, drafts, projections and trending, none of
 * which change during a game window. Running that every five minutes would be
 * almost entirely wasted work against Sleeper's API and your database. This
 * touches one endpoint per league instead, and reads league/team identity from
 * the cache rather than re-fetching it.
 *
 * It deliberately does not create anything: if a league or team is not already
 * cached, it is skipped and a full sync is what fixes that.
 */
export async function syncLiveScores(
  season?: string,
  week?: number,
): Promise<SyncResult> {
  return recorded("live", "sleeper", async () => {
    const db = requireDb();
    const warnings: string[] = [];

    const state = await sleeper.getState();
    if (!state) throw new Error("Sleeper returned no NFL state");

    const resolvedSeason =
      season ?? env.season ?? state.league_season ?? state.season;
    const resolvedWeek = week ?? resolveViewedWeek(state);

    const leagueRows = await db
      .select({
        id: leagues.id,
        platformLeagueId: leagues.platformLeagueId,
        name: leagues.name,
        status: leagues.status,
      })
      .from(leagues)
      .where(and(eq(leagues.season, resolvedSeason), eq(leagues.platform, "sleeper")));

    if (leagueRows.length === 0) {
      return {
        stats: { leagues: 0, matchups: 0 },
        warnings: [
          `Nothing cached for ${resolvedSeason}; run a full sync before live scoring.`,
        ],
      };
    }

    // Leagues that have not drafted have no scores to move.
    const active = leagueRows.filter(
      (l) => l.status !== "pre_draft" && l.status !== "drafting",
    );

    const teamRows = await db
      .select({
        id: teams.id,
        leagueId: teams.leagueId,
        platformTeamId: teams.platformTeamId,
      })
      .from(teams)
      .where(inArray(teams.leagueId, active.map((l) => l.id)));

    /** leagueId -> (sleeper roster_id -> our team uuid) */
    const teamIdsByLeague = new Map<string, Map<number, string>>();
    for (const t of teamRows) {
      const map = teamIdsByLeague.get(t.leagueId) ?? new Map<number, string>();
      map.set(Number(t.platformTeamId), t.id);
      teamIdsByLeague.set(t.leagueId, map);
    }

    const knownPlayers = new Set(
      (await db.select({ id: players.id }).from(players)).map((r) => r.id),
    );

    const stats = { leagues: 0, matchups: 0, playerScores: 0 };

    // Fetch every league's week concurrently; the client gate keeps it polite.
    const fetched = await Promise.all(
      active.map(async (league) => {
        try {
          const rows = await sleeper.getMatchups(
            league.platformLeagueId,
            resolvedWeek,
          );
          return { league, rows };
        } catch (err) {
          warnings.push(
            `Live scores for "${league.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return { league, rows: null };
        }
      }),
    );

    for (const { league, rows: weekMatchups } of fetched) {
      if (!weekMatchups || weekMatchups.length === 0) continue;
      const teamIdByRosterId = teamIdsByLeague.get(league.id);
      if (!teamIdByRosterId) continue;

      const byMatchupId = new Map<number, typeof weekMatchups>();
      for (const m of weekMatchups) {
        if (m.matchup_id == null) continue;
        const list = byMatchupId.get(m.matchup_id) ?? [];
        list.push(m);
        byMatchupId.set(m.matchup_id, list);
      }

      const rows = weekMatchups
        .map((m) => {
          const teamId = teamIdByRosterId.get(m.roster_id);
          if (!teamId) return null;
          const opp =
            m.matchup_id != null
              ? byMatchupId.get(m.matchup_id)?.find((x) => x.roster_id !== m.roster_id)
              : undefined;
          return {
            leagueId: league.id,
            season: resolvedSeason,
            week: resolvedWeek,
            platformMatchupId: m.matchup_id != null ? String(m.matchup_id) : null,
            teamId,
            opponentTeamId: opp
              ? (teamIdByRosterId.get(opp.roster_id) ?? null)
              : null,
            points: num(m.custom_points ?? m.points),
            updatedAt: new Date(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length === 0) continue;

      const inserted = await db
        .insert(matchups)
        .values(rows)
        .onConflictDoUpdate({
          target: [matchups.leagueId, matchups.week, matchups.teamId],
          set: {
            platformMatchupId: sql`excluded.platform_matchup_id`,
            opponentTeamId: sql`excluded.opponent_team_id`,
            points: sql`excluded.points`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: matchups.id, teamId: matchups.teamId });

      stats.leagues++;
      stats.matchups += inserted.length;

      const matchupIdByTeam = new Map(inserted.map((m) => [m.teamId, m.id]));

      const playerRows = [];
      for (const m of weekMatchups) {
        const teamId = teamIdByRosterId.get(m.roster_id);
        if (!teamId) continue;
        const matchupId = matchupIdByTeam.get(teamId);
        if (!matchupId) continue;

        const starterIndex = new Map<string, number>();
        (m.starters ?? []).forEach((pid, i) => {
          if (pid && pid !== "0") starterIndex.set(pid, i);
        });

        for (const [pid, pts] of Object.entries(m.players_points ?? {})) {
          if (!knownPlayers.has(pid)) continue;
          playerRows.push({
            matchupId,
            playerId: pid,
            points: pts,
            isStarter: starterIndex.has(pid),
            slotIndex: starterIndex.get(pid) ?? null,
          });
        }
      }

      for (const batch of chunk(playerRows)) {
        await db
          .insert(matchupPlayers)
          .values(batch)
          .onConflictDoUpdate({
            target: [matchupPlayers.matchupId, matchupPlayers.playerId],
            set: {
              points: sql`excluded.points`,
              isStarter: sql`excluded.is_starter`,
              slotIndex: sql`excluded.slot_index`,
            },
          });
      }
      stats.playerScores += playerRows.length;
    }

    return { stats, warnings };
  });
}

/* -------------------------------------------------------------------------
   Projections
   ------------------------------------------------------------------------- */

/**
 * Weekly projections for the given weeks.
 *
 * The endpoint is undocumented, so a failure here is downgraded to a warning:
 * the dashboard still works without projections, it just shows "—" for them.
 */
export async function syncProjections(
  season: string,
  weeks: number[],
): Promise<SyncResult> {
  return recorded("projections", "sleeper", async () => {
    const db = requireDb();
    const warnings: string[] = [];
    let written = 0;

    const knownPlayers = new Set(
      (await db.select({ id: players.id }).from(players)).map((r) => r.id),
    );

    for (const week of weeks) {
      let rows: Awaited<ReturnType<typeof sleeper.getProjections>>;
      try {
        rows = await sleeper.getProjections(season, week);
      } catch (err) {
        warnings.push(
          `Projections for week ${week} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      if (!rows || rows.length === 0) {
        warnings.push(`No projections published for ${season} week ${week}.`);
        continue;
      }

      const values = rows
        .filter((r) => r.stats && knownPlayers.has(r.player_id))
        .map((r) => ({
          season,
          week,
          playerId: r.player_id,
          company: r.company ?? null,
          stats: r.stats as Record<string, number>,
          ptsPpr: r.stats?.pts_ppr ?? null,
          ptsHalfPpr: r.stats?.pts_half_ppr ?? null,
          ptsStd: r.stats?.pts_std ?? null,
          opponent: r.opponent ?? null,
          updatedAt: new Date(),
        }));

      for (const batch of chunk(values)) {
        await db
          .insert(playerProjections)
          .values(batch)
          .onConflictDoUpdate({
            target: [
              playerProjections.season,
              playerProjections.week,
              playerProjections.playerId,
            ],
            set: {
              company: sql`excluded.company`,
              stats: sql`excluded.stats`,
              ptsPpr: sql`excluded.pts_ppr`,
              ptsHalfPpr: sql`excluded.pts_half_ppr`,
              ptsStd: sql`excluded.pts_std`,
              opponent: sql`excluded.opponent`,
              updatedAt: sql`now()`,
            },
          });
      }
      written += values.length;
    }

    return { stats: { projections: written }, warnings };
  });
}

/* -------------------------------------------------------------------------
   Trending
   ------------------------------------------------------------------------- */

export async function syncTrending(): Promise<SyncResult> {
  return recorded("trending", "sleeper", async () => {
    const db = requireDb();
    const warnings: string[] = [];
    let written = 0;

    for (const kind of ["add", "drop"] as const) {
      const rows = await sleeper.getTrending(kind, 24, 25);
      if (!rows || rows.length === 0) continue;

      // A trending player may predate our last player sync; skip unknown ids
      // rather than violating the foreign key.
      const known = await db
        .select({ id: players.id })
        .from(players)
        .where(inArray(players.id, rows.map((r) => r.player_id)));
      const knownIds = new Set(known.map((k) => k.id));
      const usable = rows.filter((r) => knownIds.has(r.player_id));
      if (usable.length < rows.length) {
        warnings.push(
          `${rows.length - usable.length} trending ${kind} rows referenced unknown players; run a player sync.`,
        );
      }
      if (usable.length === 0) continue;

      await db.delete(trendingPlayers).where(eq(trendingPlayers.kind, kind));
      await db.insert(trendingPlayers).values(
        usable.map((r) => ({
          platform: "sleeper" as const,
          playerId: r.player_id,
          kind,
          count: r.count,
          lookbackHours: 24,
          capturedAt: new Date(),
        })),
      );
      written += usable.length;
    }

    return { stats: { trending: written }, warnings };
  });
}

/* -------------------------------------------------------------------------
   Leagues
   ------------------------------------------------------------------------- */

export interface SyncLeaguesOptions {
  season?: string;
  /** Weeks of matchups to pull. Defaults to 1..currentWeek. */
  weeks?: number[];
  includeDrafts?: boolean;
}

/**
 * The main job: every Sleeper league the account belongs to, with rosters,
 * matchups and drafts.
 */
export async function syncSleeperLeagues(
  options: SyncLeaguesOptions = {},
): Promise<SyncResult> {
  return recorded("leagues", "sleeper", async () => {
    const db = requireDb();
    const warnings: string[] = [];

    const state = await sleeper.getState();
    if (!state) throw new Error("Sleeper returned no NFL state");

    const season = options.season ?? env.season ?? state.league_season ?? state.season;
    const currentWeek = resolveViewedWeek(state);
    const weeks =
      options.weeks ?? Array.from({ length: currentWeek }, (_, i) => i + 1);

    const user = await sleeper.getUser(env.sleeperUsername);
    if (!user) {
      throw new Error(
        `Sleeper has no user named "${env.sleeperUsername}". Check SLEEPER_USERNAME.`,
      );
    }

    /* -- account -- */
    const [account] = await db
      .insert(accounts)
      .values({
        platform: "sleeper",
        platformUserId: user.user_id,
        username: user.username,
        displayName: user.display_name,
        avatar: user.avatar,
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [accounts.platform, accounts.platformUserId],
        set: {
          username: sql`excluded.username`,
          displayName: sql`excluded.display_name`,
          avatar: sql`excluded.avatar`,
          lastSyncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: accounts.id });

    const leagueList = await sleeper.getLeagues(user.user_id, season);
    if (!leagueList || leagueList.length === 0) {
      return {
        stats: { leagues: 0 },
        warnings: [`No Sleeper leagues for ${env.sleeperUsername} in ${season}.`],
      };
    }

    // Players already in the cache — anything on a roster but missing here is
    // skipped with a warning rather than blowing up the foreign key.
    const knownPlayers = new Set(
      (await db.select({ id: players.id }).from(players)).map((r) => r.id),
    );
    if (knownPlayers.size === 0) {
      throw new Error(
        "The players table is empty. Run `npm run sync:players` before syncing leagues.",
      );
    }

    const stats = {
      leagues: 0,
      teams: 0,
      rosterSlots: 0,
      matchups: 0,
      draftPicks: 0,
      skippedPlayers: 0,
    };

    for (const leagueSummary of leagueList) {
      const bundle = await fetchLeagueBundle(leagueSummary.league_id, {
        weeks,
        includeDraft: options.includeDrafts ?? true,
      }).catch((err) => {
        warnings.push(
          `Could not load "${leagueSummary.name.trim()}": ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });
      if (!bundle) continue;

      const { league, users, rosters, matchupsByWeek } = bundle;

      /* -- league -- */
      const [leagueRow] = await db
        .insert(leagues)
        .values({
          platform: "sleeper",
          platformLeagueId: league.league_id,
          accountId: account.id,
          season: league.season,
          name: league.name.trim(),
          avatar: league.avatar,
          status: league.status,
          totalRosters: league.total_rosters,
          rosterPositions: league.roster_positions,
          scoringSettings: league.scoring_settings,
          settings: league.settings,
          previousPlatformLeagueId: league.previous_league_id,
          platformDraftId: league.draft_id,
          raw: league,
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [leagues.platform, leagues.platformLeagueId, leagues.season],
          set: {
            name: sql`excluded.name`,
            avatar: sql`excluded.avatar`,
            status: sql`excluded.status`,
            totalRosters: sql`excluded.total_rosters`,
            rosterPositions: sql`excluded.roster_positions`,
            scoringSettings: sql`excluded.scoring_settings`,
            settings: sql`excluded.settings`,
            previousPlatformLeagueId: sql`excluded.previous_platform_league_id`,
            platformDraftId: sql`excluded.platform_draft_id`,
            raw: sql`excluded.raw`,
            lastSyncedAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: leagues.id });

      stats.leagues++;

      /* -- members -- */
      const memberIdByPlatformUser = new Map<string, string>();
      if (users.length > 0) {
        const inserted = await db
          .insert(leagueMembers)
          .values(
            users.map((u) => ({
              leagueId: leagueRow.id,
              platformUserId: u.user_id,
              displayName: u.display_name,
              teamName: u.metadata?.team_name?.trim() || null,
              avatar: u.avatar,
              isMe: u.user_id === user.user_id,
              raw: u,
            })),
          )
          .onConflictDoUpdate({
            target: [leagueMembers.leagueId, leagueMembers.platformUserId],
            set: {
              displayName: sql`excluded.display_name`,
              teamName: sql`excluded.team_name`,
              avatar: sql`excluded.avatar`,
              isMe: sql`excluded.is_me`,
              raw: sql`excluded.raw`,
              updatedAt: sql`now()`,
            },
          })
          .returning({
            id: leagueMembers.id,
            platformUserId: leagueMembers.platformUserId,
          });
        for (const m of inserted) memberIdByPlatformUser.set(m.platformUserId, m.id);
      }

      /* -- teams -- */
      const userById = new Map(users.map((u) => [u.user_id, u]));
      const teamIdByRosterId = new Map<number, string>();

      if (rosters.length > 0) {
        const inserted = await db
          .insert(teams)
          .values(
            rosters.map((r) => {
              const owner = r.owner_id ? userById.get(r.owner_id) : undefined;
              const s = r.settings;
              const isMine =
                r.owner_id === user.user_id ||
                (r.co_owners ?? []).includes(user.user_id);
              return {
                leagueId: leagueRow.id,
                platformTeamId: String(r.roster_id),
                memberId: r.owner_id
                  ? (memberIdByPlatformUser.get(r.owner_id) ?? null)
                  : null,
                name: teamNameFor(owner, r.roster_id),
                avatar: owner?.avatar ?? null,
                isMine,
                wins: s.wins ?? 0,
                losses: s.losses ?? 0,
                ties: s.ties ?? 0,
                pointsFor: num(combinePoints(s.fpts, s.fpts_decimal)) ?? "0",
                pointsAgainst:
                  num(combinePoints(s.fpts_against, s.fpts_against_decimal)) ?? "0",
                potentialPoints: num(combinePoints(s.ppts, s.ppts_decimal)),
                waiverPosition: s.waiver_position ?? null,
                waiverBudgetUsed: s.waiver_budget_used ?? null,
                division: s.division ?? null,
                raw: r,
              };
            }),
          )
          .onConflictDoUpdate({
            target: [teams.leagueId, teams.platformTeamId],
            set: {
              memberId: sql`excluded.member_id`,
              name: sql`excluded.name`,
              avatar: sql`excluded.avatar`,
              isMine: sql`excluded.is_mine`,
              wins: sql`excluded.wins`,
              losses: sql`excluded.losses`,
              ties: sql`excluded.ties`,
              pointsFor: sql`excluded.points_for`,
              pointsAgainst: sql`excluded.points_against`,
              potentialPoints: sql`excluded.potential_points`,
              waiverPosition: sql`excluded.waiver_position`,
              waiverBudgetUsed: sql`excluded.waiver_budget_used`,
              division: sql`excluded.division`,
              raw: sql`excluded.raw`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: teams.id, platformTeamId: teams.platformTeamId });

        for (const t of inserted) {
          teamIdByRosterId.set(Number(t.platformTeamId), t.id);
        }
        stats.teams += inserted.length;
      }

      /* -- roster slots -- */
      const startSlots = (league.roster_positions ?? []).filter(
        (p) => p !== "BN" && p !== "IR" && p !== "TAXI",
      );

      for (const roster of rosters) {
        const teamId = teamIdByRosterId.get(roster.roster_id);
        if (!teamId) continue;

        const starterSlot = new Map<string, { slot: string; index: number }>();
        (roster.starters ?? []).forEach((pid, i) => {
          if (!pid || pid === "0") return;
          starterSlot.set(pid, { slot: startSlots[i] ?? "FLEX", index: i });
        });

        const reserve = new Set(roster.reserve ?? []);
        const taxi = new Set(roster.taxi ?? []);
        const allIds = new Set<string>([
          ...(roster.players ?? []),
          ...starterSlot.keys(),
        ]);

        const slotRows = [];
        for (const pid of allIds) {
          if (!knownPlayers.has(pid)) {
            stats.skippedPlayers++;
            continue;
          }
          const st = starterSlot.get(pid);
          slotRows.push({
            teamId,
            playerId: pid,
            kind: st
              ? ("starter" as const)
              : reserve.has(pid)
                ? ("ir" as const)
                : taxi.has(pid)
                  ? ("taxi" as const)
                  : ("bench" as const),
            slotPosition: st?.slot ?? "BN",
            slotIndex: st?.index ?? null,
            updatedAt: new Date(),
          });
        }

        // Rewrite this team's roster wholesale so dropped players disappear.
        if (slotRows.length > 0) {
          for (const batch of chunk(slotRows)) {
            await db
              .insert(rosterSlots)
              .values(batch)
              .onConflictDoUpdate({
                target: [rosterSlots.teamId, rosterSlots.playerId],
                set: {
                  kind: sql`excluded.kind`,
                  slotPosition: sql`excluded.slot_position`,
                  slotIndex: sql`excluded.slot_index`,
                  updatedAt: sql`now()`,
                },
              });
          }
          await db
            .delete(rosterSlots)
            .where(
              and(
                eq(rosterSlots.teamId, teamId),
                notInArray(rosterSlots.playerId, slotRows.map((r) => r.playerId)),
              ),
            );
          stats.rosterSlots += slotRows.length;
        } else {
          await db.delete(rosterSlots).where(eq(rosterSlots.teamId, teamId));
        }
      }

      /* -- matchups -- */
      for (const [week, weekMatchups] of matchupsByWeek) {
        const byMatchupId = new Map<number, typeof weekMatchups>();
        for (const m of weekMatchups) {
          if (m.matchup_id == null) continue;
          const list = byMatchupId.get(m.matchup_id) ?? [];
          list.push(m);
          byMatchupId.set(m.matchup_id, list);
        }

        const rows = weekMatchups
          .map((m) => {
            const teamId = teamIdByRosterId.get(m.roster_id);
            if (!teamId) return null;
            const opp =
              m.matchup_id != null
                ? byMatchupId
                    .get(m.matchup_id)
                    ?.find((x) => x.roster_id !== m.roster_id)
                : undefined;
            return {
              leagueId: leagueRow.id,
              season: league.season,
              week,
              platformMatchupId:
                m.matchup_id != null ? String(m.matchup_id) : null,
              teamId,
              opponentTeamId: opp
                ? (teamIdByRosterId.get(opp.roster_id) ?? null)
                : null,
              points: num(m.custom_points ?? m.points),
              updatedAt: new Date(),
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (rows.length === 0) continue;

        const inserted = await db
          .insert(matchups)
          .values(rows)
          .onConflictDoUpdate({
            target: [matchups.leagueId, matchups.week, matchups.teamId],
            set: {
              platformMatchupId: sql`excluded.platform_matchup_id`,
              opponentTeamId: sql`excluded.opponent_team_id`,
              points: sql`excluded.points`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: matchups.id, teamId: matchups.teamId });

        stats.matchups += inserted.length;

        const matchupIdByTeam = new Map(inserted.map((m) => [m.teamId, m.id]));

        /* -- per-player matchup points -- */
        const playerRows = [];
        for (const m of weekMatchups) {
          const teamId = teamIdByRosterId.get(m.roster_id);
          if (!teamId) continue;
          const matchupId = matchupIdByTeam.get(teamId);
          if (!matchupId) continue;

          const starterIndex = new Map<string, number>();
          (m.starters ?? []).forEach((pid, i) => {
            if (pid && pid !== "0") starterIndex.set(pid, i);
          });

          for (const [pid, pts] of Object.entries(m.players_points ?? {})) {
            if (!knownPlayers.has(pid)) continue;
            playerRows.push({
              matchupId,
              playerId: pid,
              points: pts,
              isStarter: starterIndex.has(pid),
              slotIndex: starterIndex.get(pid) ?? null,
            });
          }
        }

        for (const batch of chunk(playerRows)) {
          await db
            .insert(matchupPlayers)
            .values(batch)
            .onConflictDoUpdate({
              target: [matchupPlayers.matchupId, matchupPlayers.playerId],
              set: {
                points: sql`excluded.points`,
                isStarter: sql`excluded.is_starter`,
                slotIndex: sql`excluded.slot_index`,
              },
            });
        }
      }

      /* -- draft -- */
      if (bundle.draft) {
        const d = bundle.draft;
        const [draftRow] = await db
          .insert(drafts)
          .values({
            leagueId: leagueRow.id,
            platformDraftId: d.draft_id,
            season: d.season,
            type: d.type,
            status: d.status,
            rounds: d.settings?.rounds ?? null,
            startTime: d.start_time ? new Date(d.start_time) : null,
            settings: d.settings,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: drafts.platformDraftId,
            set: {
              status: sql`excluded.status`,
              rounds: sql`excluded.rounds`,
              settings: sql`excluded.settings`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: drafts.id });

        if (bundle.draftPicks.length > 0) {
          const pickRows = bundle.draftPicks.map((p) => ({
            draftId: draftRow.id,
            pickNo: p.pick_no,
            round: p.round,
            draftSlot: p.draft_slot ?? null,
            teamId:
              p.roster_id != null
                ? (teamIdByRosterId.get(p.roster_id) ?? null)
                : null,
            playerId:
              p.player_id && knownPlayers.has(p.player_id) ? p.player_id : null,
            pickedByPlatformUserId: p.picked_by ?? null,
            isKeeper: Boolean(p.is_keeper),
            // Keep Sleeper's name snapshot so retired players still render.
            metadata: p.metadata,
            updatedAt: new Date(),
          }));

          for (const batch of chunk(pickRows)) {
            await db
              .insert(draftPicks)
              .values(batch)
              .onConflictDoUpdate({
                target: [draftPicks.draftId, draftPicks.pickNo],
                set: {
                  teamId: sql`excluded.team_id`,
                  playerId: sql`excluded.player_id`,
                  pickedByPlatformUserId: sql`excluded.picked_by_platform_user_id`,
                  isKeeper: sql`excluded.is_keeper`,
                  metadata: sql`excluded.metadata`,
                  updatedAt: sql`now()`,
                },
              });
          }
          stats.draftPicks += pickRows.length;
        }
      }
    }

    if (stats.skippedPlayers > 0) {
      warnings.push(
        `${stats.skippedPlayers} rostered player ids were not in the player table; re-run \`npm run sync:players\`.`,
      );
    }

    return { stats, warnings };
  });
}

/* -------------------------------------------------------------------------
   Orchestration
   ------------------------------------------------------------------------- */

export interface SyncAllOptions extends SyncLeaguesOptions {
  /**
   * Force a refresh of the 15MB player dump. Left false, the dump is still
   * pulled automatically when the players table is empty, since leagues cannot
   * be written before the players they reference exist.
   */
  includePlayers?: boolean;
  /**
   * Force a bye-week refresh from ESPN. Left false, byes are still pulled the
   * first time a season is synced.
   */
  includeSchedule?: boolean;
  /**
   * Force a rebuild of the ESPN player crosswalk. Left false, it is built the
   * first time and then only on request — ESPN's universe moves slowly.
   */
  includeEspnIds?: boolean;
}

/** Runs the jobs in dependency order: players -> state/schedule -> leagues. */
export async function syncAll(options: SyncAllOptions = {}): Promise<SyncResult[]> {
  const db = requireDb();
  const results: SyncResult[] = [];

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(players);

  // Forced by the caller, or unavoidable because the table is empty.
  if (options.includePlayers || count === 0) {
    results.push(await syncPlayers(options.includePlayers));
  }

  results.push(await syncNflState());

  const state = await sleeper.getState();
  const season =
    options.season ?? env.season ?? state?.league_season ?? state?.season ?? "";

  const [{ count: byeCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nflTeams)
    .where(eq(nflTeams.season, season));

  if (options.includeSchedule || byeCount === 0) {
    results.push(await syncSchedule(season));
  }

  /*
   * The ESPN crosswalk depends on the canonical players above and on nothing
   * else, so it runs before any league sync. It is also the one job here that
   * talks to a platform we cannot read leagues from yet — building the id map
   * early means the mapping is already correct and already exercised on the
   * day ESPN leagues do land.
   */
  const [{ count: espnAliasCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(playerAliases)
    .where(eq(playerAliases.platform, "espn"));

  if (options.includeEspnIds || espnAliasCount === 0) {
    try {
      results.push(await syncEspnAliases(season));
    } catch (err) {
      // ESPN is undocumented and unsupported; it must never be able to fail a
      // sync whose Sleeper half is perfectly healthy.
      results.push({
        scope: "espn-ids",
        stats: {},
        warnings: [
          `ESPN id crosswalk skipped: ${err instanceof Error ? err.message : String(err)}`,
        ],
        durationMs: 0,
      });
    }
  }

  results.push(await syncSleeperLeagues({ ...options, season }));

  // ESPN is optional and unsupported upstream; it must never fail a sync whose
  // Sleeper half is healthy.
  if (env.espnLeagueIds.length > 0) {
    try {
      results.push(await syncEspnLeagues({ season, weeks: options.weeks }));
    } catch (err) {
      results.push({
        scope: "espn",
        stats: {},
        warnings: [
          `ESPN league sync failed: ${err instanceof Error ? err.message : String(err)}`,
        ],
        durationMs: 0,
      });
    }
  }

  // Projections only exist for the current and upcoming weeks, so there is no
  // point re-pulling the whole season.
  const currentWeek = resolveViewedWeek(state ?? { season, season_type: "pre", week: 1, display_week: 1, league_season: season, previous_season: "", season_start_date: "", leg: 0 });
  results.push(
    await syncProjections(season, [currentWeek, currentWeek + 1].filter((w) => w >= 1 && w <= 18)),
  );

  results.push(await syncTrending());

  return results;
}
