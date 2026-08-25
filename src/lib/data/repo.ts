/**
 * Reads the Postgres cache back out as the domain model.
 *
 * Deliberately a handful of wide queries assembled in memory rather than a
 * query per league: the whole dataset is a few thousand rows, and one round
 * trip per table keeps the dashboard well under a hundred milliseconds even on
 * a remote Supabase instance.
 */
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db/client";
import { describeDbError, isMissingRelation } from "@/lib/db/errors";
import { startingSlots } from "@/lib/domain/positions";
import { MIN_CONSISTENCY_SAMPLES } from "@/lib/domain/analytics";
import { projectedPoints, sumProjected, type ProjectionSource } from "@/lib/domain/scoring";
import type {
  Consistency,
  DashboardData,
  DraftView,
  LeagueTeam,
  MyTeam,
  NflStateView,
  RosterPlayer,
  TrendingPlayer,
  WeekMatchup,
  WeeklyPoint,
} from "@/lib/domain/types";
import { env } from "@/lib/env";
import { recordString } from "@/lib/platforms/sleeper/normalize";
import { sleeperAvatarUrl } from "@/lib/platforms/sleeper/client";
import { resolveViewedWeek } from "@/lib/platforms/sleeper/fetch";

const {
  draftPicks,
  drafts,
  leagueMembers,
  leagues,
  matchupPlayers,
  matchups,
  nflState,
  nflTeams,
  playerProjections,
  players,
  rosterSlots,
  syncRuns,
  teams,
  trendingPlayers,
} = schema;

const toNum = (v: string | number | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : Number(v);

const toNumOrNull = (v: string | number | null | undefined): number | null =>
  v == null ? null : typeof v === "number" ? v : Number(v);

/** Coefficient-of-variation buckets — must match analytics.consistencyFrom. */
function classifyConsistency(cv: number): Consistency {
  if (cv >= 0.65) return "Volatile";
  if (cv <= 0.35) return "Steady";
  return "Boom";
}

export interface RepoOptions {
  week?: number;
  season?: string;
}

/**
 * Builds the dashboard from cache. Returns null when the cache holds nothing
 * for the requested season, so the caller can fall back to a live fetch.
 */
export async function loadDashboardFromCache(
  options: RepoOptions = {},
): Promise<DashboardData | null> {
  const db = getDb();
  if (!db) return null;

  /* -- NFL state -- */
  const [stateRow] = await db
    .select()
    .from(nflState)
    .where(eq(nflState.id, "nfl"))
    .limit(1);
  if (!stateRow) return null;

  const season =
    options.season ?? env.season ?? stateRow.leagueSeason ?? stateRow.season;

  const viewedWeek =
    options.week ??
    resolveViewedWeek({
      season: stateRow.season,
      season_type: stateRow.seasonType,
      week: stateRow.week,
      display_week: stateRow.displayWeek,
      league_season: stateRow.leagueSeason ?? stateRow.season,
      previous_season: stateRow.previousSeason ?? "",
      season_start_date: stateRow.seasonStartDate ?? "",
      leg: 0,
    });

  const stateView: NflStateView = {
    season,
    seasonType: stateRow.seasonType,
    week: stateRow.week,
    displayWeek: stateRow.displayWeek,
    inSeason: stateRow.seasonType === "regular" || stateRow.seasonType === "post",
  };

  /* -- leagues -- */
  const leagueRows = await db
    .select()
    .from(leagues)
    .where(eq(leagues.season, season));

  if (leagueRows.length === 0) return null;

  const leagueIds = leagueRows.map((l) => l.id);

  /* -- teams + their owners -- */
  const teamRows = await db
    .select({
      team: teams,
      memberDisplayName: leagueMembers.displayName,
      memberAvatar: leagueMembers.avatar,
    })
    .from(teams)
    .leftJoin(leagueMembers, eq(teams.memberId, leagueMembers.id))
    .where(inArray(teams.leagueId, leagueIds));

  if (teamRows.length === 0) return null;

  const teamIds = teamRows.map((r) => r.team.id);

  /* -- rosters, joined to the player dimension -- */
  const slotRows = await db
    .select({
      teamId: rosterSlots.teamId,
      kind: rosterSlots.kind,
      slotPosition: rosterSlots.slotPosition,
      slotIndex: rosterSlots.slotIndex,
      playerId: players.id,
      fullName: players.fullName,
      position: players.position,
      nflTeam: players.nflTeam,
      status: players.status,
      injuryStatus: players.injuryStatus,
      injuryBodyPart: players.injuryBodyPart,
      depthChartOrder: players.depthChartOrder,
      searchRank: players.searchRank,
      yearsExp: players.yearsExp,
      age: players.age,
    })
    .from(rosterSlots)
    .innerJoin(players, eq(rosterSlots.playerId, players.id))
    .where(inArray(rosterSlots.teamId, teamIds));

  /* -- matchups up to the viewed week -- */
  const matchupRows = await db
    .select()
    .from(matchups)
    .where(
      and(
        inArray(matchups.leagueId, leagueIds),
        eq(matchups.season, season),
        lte(matchups.week, viewedWeek),
      ),
    );

  const viewedMatchupIds = matchupRows
    .filter((m) => m.week === viewedWeek)
    .map((m) => m.id);

  const matchupPlayerRows =
    viewedMatchupIds.length > 0
      ? await db
          .select()
          .from(matchupPlayers)
          .where(inArray(matchupPlayers.matchupId, viewedMatchupIds))
      : [];

  /**
   * Season-long scoring per player per team, aggregated in Postgres rather than
   * pulled row by row — at week 15 that would otherwise be tens of thousands of
   * rows just to compute an average and a standard deviation.
   */
  const seasonStatRows = await db
    .select({
      teamId: matchups.teamId,
      playerId: matchupPlayers.playerId,
      avgPoints: sql<number>`avg(${matchupPlayers.points})::float8`,
      stdDev: sql<number>`coalesce(stddev_pop(${matchupPlayers.points}), 0)::float8`,
      samples: sql<number>`count(*)::int`,
    })
    .from(matchupPlayers)
    .innerJoin(matchups, eq(matchupPlayers.matchupId, matchups.id))
    .where(
      and(
        inArray(matchups.leagueId, leagueIds),
        eq(matchups.season, season),
        lte(matchups.week, viewedWeek),
      ),
    )
    .groupBy(matchups.teamId, matchupPlayers.playerId);

  const seasonStats = new Map<
    string,
    { avg: number; stdDev: number; samples: number }
  >();
  for (const r of seasonStatRows) {
    seasonStats.set(`${r.teamId}:${r.playerId}`, {
      avg: r.avgPoints,
      stdDev: r.stdDev,
      samples: r.samples,
    });
  }

  /* -- bye weeks -- */
  const byeRows = await db
    .select({ abbr: nflTeams.abbr, byeWeek: nflTeams.byeWeek })
    .from(nflTeams)
    .where(eq(nflTeams.season, season));
  const byeWeeks: Record<string, number> = {};
  for (const r of byeRows) if (r.byeWeek != null) byeWeeks[r.abbr] = r.byeWeek;

  /* -- projections for the viewed week -- */
  /*
   * Projections are an enhancement, not load-bearing. If this table is missing
   * (schema not migrated yet) or the query fails for any other reason, the
   * dashboard still renders from cache with projections shown as "—" — far
   * better than throwing the whole cache away and falling back to a slow live
   * fetch because one optional table is unavailable.
   */
  const projectionSources = new Map<string, ProjectionSource>();
  const warnings: string[] = [];

  try {
    const projectionRows = await db
      .select()
      .from(playerProjections)
      .where(
        and(
          eq(playerProjections.season, season),
          eq(playerProjections.week, viewedWeek),
        ),
      );

    for (const r of projectionRows) {
      projectionSources.set(r.playerId, {
        stats: (r.stats ?? {}) as Record<string, number>,
        ptsPpr: r.ptsPpr,
        ptsHalfPpr: r.ptsHalfPpr,
        ptsStd: r.ptsStd,
      });
    }
  } catch (err) {
    warnings.push(
      isMissingRelation(err)
        ? `Projections are unavailable until the schema is migrated: ${describeDbError(err)}`
        : `Could not read projections: ${describeDbError(err)}`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* assemble                                                          */
  /* ---------------------------------------------------------------- */

  const slotsByTeam = new Map<string, typeof slotRows>();
  for (const s of slotRows) {
    const list = slotsByTeam.get(s.teamId) ?? [];
    list.push(s);
    slotsByTeam.set(s.teamId, list);
  }

  /** teamId -> { playerId -> points } for the viewed week. */
  const pointsByTeam = new Map<string, Map<string, number>>();
  const matchupById = new Map(matchupRows.map((m) => [m.id, m]));
  for (const mp of matchupPlayerRows) {
    const m = matchupById.get(mp.matchupId);
    if (!m) continue;
    const map = pointsByTeam.get(m.teamId) ?? new Map<string, number>();
    if (mp.points != null) map.set(mp.playerId, mp.points);
    pointsByTeam.set(m.teamId, map);
  }

  /** Rosters are built per league so projections use that league’s scoring. */
  const buildRosterFor = (
    teamId: string,
    scoring: Record<string, number> | null,
  ): RosterPlayer[] => {
    const pts = pointsByTeam.get(teamId);
    return (slotsByTeam.get(teamId) ?? []).map((s) => {
      const stats = seasonStats.get(`${teamId}:${s.playerId}`);
      // Same rule as the live path: no label until there is enough sample.
      const consistency =
        stats && stats.samples >= MIN_CONSISTENCY_SAMPLES && stats.avg > 0
          ? classifyConsistency(stats.stdDev / stats.avg)
          : null;

      return {
        id: s.playerId,
        name: s.fullName,
        position: s.position ?? "—",
        nflTeam: s.nflTeam ?? "",
        // injuryStatus is the live designation; status is the roster designation.
        status: s.injuryStatus?.trim() || s.status?.trim() || "Active",
        injuryBodyPart: s.injuryBodyPart,
        slotPosition: s.slotPosition,
        slotIndex: s.slotIndex,
        kind: s.kind,
        starter: s.kind === "starter",
        points: pts?.get(s.playerId) ?? null,
        projectedPoints: projectedPoints(
          projectionSources.get(s.playerId),
          scoring,
        ),
        byeWeek: s.nflTeam ? (byeWeeks[s.nflTeam] ?? null) : null,
        nickname: null,
        depthChartOrder: s.depthChartOrder,
        searchRank: s.searchRank,
        yearsExp: s.yearsExp,
        age: s.age,
        seasonAvgPoints: stats ? Math.round(stats.avg * 10) / 10 : null,
        seasonSamples: stats?.samples ?? 0,
        consistency,
      };
    });
  };

  const teamsByLeague = new Map<string, typeof teamRows>();
  for (const r of teamRows) {
    const list = teamsByLeague.get(r.team.leagueId) ?? [];
    list.push(r);
    teamsByLeague.set(r.team.leagueId, list);
  }

  const matchupsByTeamWeek = new Map<string, (typeof matchupRows)[number]>();
  for (const m of matchupRows) matchupsByTeamWeek.set(`${m.teamId}:${m.week}`, m);

  const teamNameById = new Map(teamRows.map((r) => [r.team.id, r.team.name ?? "—"]));

  const myTeams: MyTeam[] = [];

  for (const league of leagueRows) {
    const leagueTeamRows = teamsByLeague.get(league.id) ?? [];
    const mineRow = leagueTeamRows.find((r) => r.team.isMine);
    if (!mineRow) continue;

    const scoring = (league.scoringSettings ?? null) as Record<string, number> | null;

    const leagueTeams: LeagueTeam[] = leagueTeamRows.map((r) => {
      const t = r.team;
      const m = matchupsByTeamWeek.get(`${t.id}:${viewedWeek}`);
      return {
        id: `sleeper-${league.platformLeagueId}-${t.platformTeamId}`,
        platformTeamId: t.platformTeamId,
        name: t.name ?? `Roster ${t.platformTeamId}`,
        ownerName: r.memberDisplayName ?? null,
        avatar: sleeperAvatarUrl(t.avatar ?? r.memberAvatar),
        isMine: t.isMine,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        record: recordString(t.wins, t.losses, t.ties),
        pointsFor: toNum(t.pointsFor),
        pointsAgainst: toNum(t.pointsAgainst),
        roster: buildRosterFor(t.id, scoring),
        weekScore: toNumOrNull(m?.points),
        weekProjected: null, // set below, once the roster exists
      };
    });

    for (const t of leagueTeams) {
      const values = t.roster.filter((p) => p.starter).map((p) => p.projectedPoints);
      t.weekProjected = values.some((v) => v != null) ? sumProjected(values) : null;
    }

    const mine = mineRow.team;
    const myLeagueTeam = leagueTeams.find((t) => t.isMine)!;

    /* -- current matchup -- */
    let matchup: WeekMatchup | null = null;
    const myMatchupRow = matchupsByTeamWeek.get(`${mine.id}:${viewedWeek}`);
    if (myMatchupRow) {
      const oppRow = myMatchupRow.opponentTeamId
        ? matchupsByTeamWeek.get(`${myMatchupRow.opponentTeamId}:${viewedWeek}`)
        : undefined;
      const oppLeagueTeam = myMatchupRow.opponentTeamId
        ? leagueTeamRows.find((r) => r.team.id === myMatchupRow.opponentTeamId)
        : undefined;

      matchup = {
        week: viewedWeek,
        matchupId: myMatchupRow.platformMatchupId,
        mine: {
          teamId: myLeagueTeam.id,
          teamName: myLeagueTeam.name,
          score: toNumOrNull(myMatchupRow.points),
          projected: myLeagueTeam.weekProjected,
        },
        opponent:
          myMatchupRow.opponentTeamId && oppLeagueTeam
            ? {
                teamId: `sleeper-${league.platformLeagueId}-${oppLeagueTeam.team.platformTeamId}`,
                teamName:
                  teamNameById.get(myMatchupRow.opponentTeamId) ?? "Opponent",
                score: toNumOrNull(oppRow?.points),
                projected: oppLeagueTeam ? (leagueTeams.find((t) => t.platformTeamId === oppLeagueTeam.team.platformTeamId)?.weekProjected ?? null) : null,
              }
            : null,
      };
    }

    /* -- weekly history -- */
    const weeklyPoints: WeeklyPoint[] = matchupRows
      .filter((m) => m.teamId === mine.id)
      .sort((a, b) => a.week - b.week)
      .map((m) => {
        const opp = m.opponentTeamId
          ? matchupsByTeamWeek.get(`${m.opponentTeamId}:${m.week}`)
          : undefined;
        return {
          week: m.week,
          label: `W${m.week}`,
          points: toNumOrNull(m.points),
          opponentPoints: toNumOrNull(opp?.points),
        };
      });

    const roster = myLeagueTeam.roster;

    myTeams.push({
      id: myLeagueTeam.id,
      platform: "sleeper",
      leagueId: `sleeper-${league.platformLeagueId}`,
      platformLeagueId: league.platformLeagueId,
      leagueName: league.name,
      season: league.season,
      leagueStatus: league.status,
      startingSlots: startingSlots(league.rosterPositions),
      totalRosters: league.totalRosters ?? leagueTeams.length,

      teamName: myLeagueTeam.name,
      avatar: myLeagueTeam.avatar,
      wins: mine.wins,
      losses: mine.losses,
      ties: mine.ties,
      record: myLeagueTeam.record,
      pointsFor: toNum(mine.pointsFor),
      pointsAgainst: toNum(mine.pointsAgainst),

      roster,
      starters: roster.filter((p) => p.starter),
      bench: roster.filter((p) => !p.starter),

      matchup,
      weeklyPoints,
      leagueTeams,
    });
  }

  myTeams.sort((a, b) => a.leagueName.localeCompare(b.leagueName));

  /* -- drafts -- */
  const draftViews = await loadDrafts(leagueRows, teamNameById);

  /* -- trending -- */
  const rostered = new Set<string>();
  for (const t of myTeams) for (const p of t.roster) rostered.add(p.id);

  const trendingRows = await db
    .select({
      playerId: trendingPlayers.playerId,
      count: trendingPlayers.count,
      fullName: players.fullName,
      position: players.position,
      nflTeam: players.nflTeam,
    })
    .from(trendingPlayers)
    .innerJoin(players, eq(trendingPlayers.playerId, players.id))
    .where(eq(trendingPlayers.kind, "add"))
    .orderBy(desc(trendingPlayers.count));

  const trending: TrendingPlayer[] = trendingRows.map((r) => ({
    playerId: r.playerId,
    name: r.fullName,
    position: r.position ?? "—",
    nflTeam: r.nflTeam ?? "",
    count: r.count,
    rostered: rostered.has(r.playerId),
  }));

  /* -- freshness -- */
  const [lastRun] = await db
    .select({ finishedAt: syncRuns.finishedAt })
    .from(syncRuns)
    .where(eq(syncRuns.status, "success"))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  return {
    state: stateView,
    viewedWeek,
    teams: myTeams,
    trending,
    drafts: draftViews,
    byeWeeks,
    lastSyncedAt: lastRun?.finishedAt?.toISOString() ?? null,
    source: "cache",
    warnings,
  };
}

/** Draft recaps for the cached leagues. */
async function loadDrafts(
  leagueRows: Array<{ id: string; platformLeagueId: string; name: string }>,
  teamNameById: Map<string, string>,
): Promise<DraftView[]> {
  const db = getDb();
  if (!db || leagueRows.length === 0) return [];

  const draftRows = await db
    .select()
    .from(drafts)
    .where(inArray(drafts.leagueId, leagueRows.map((l) => l.id)));

  if (draftRows.length === 0) return [];

  const pickRows = await db
    .select({
      pick: draftPicks,
      playerName: players.fullName,
      position: players.position,
      nflTeam: players.nflTeam,
    })
    .from(draftPicks)
    .leftJoin(players, eq(draftPicks.playerId, players.id))
    .where(inArray(draftPicks.draftId, draftRows.map((d) => d.id)));

  const picksByDraft = new Map<string, typeof pickRows>();
  for (const p of pickRows) {
    const list = picksByDraft.get(p.pick.draftId) ?? [];
    list.push(p);
    picksByDraft.set(p.pick.draftId, list);
  }

  const leagueById = new Map(leagueRows.map((l) => [l.id, l]));

  return draftRows
    .map((d) => {
      const league = leagueById.get(d.leagueId);
      const picks = (picksByDraft.get(d.id) ?? [])
        .sort((a, b) => a.pick.pickNo - b.pick.pickNo)
        .map(({ pick, playerName, position, nflTeam }) => {
          const meta = (pick.metadata ?? {}) as Record<string, string>;
          const metaName = [meta.first_name, meta.last_name]
            .filter(Boolean)
            .join(" ")
            .trim();
          return {
            pickNo: pick.pickNo,
            round: pick.round,
            draftSlot: pick.draftSlot,
            playerId: pick.playerId,
            playerName: playerName || metaName || "—",
            position: position || meta.position || "—",
            nflTeam: nflTeam || meta.team || "",
            pickedBy: pick.teamId
              ? (teamNameById.get(pick.teamId) ?? "—")
              : "—",
            isKeeper: Boolean(pick.isKeeper),
          };
        });

      return {
        leagueId: `sleeper-${league?.platformLeagueId ?? d.leagueId}`,
        leagueName: league?.name ?? "League",
        season: d.season,
        status: d.status,
        rounds: d.rounds,
        picks,
      };
    })
    .filter((d) => d.picks.length > 0);
}
