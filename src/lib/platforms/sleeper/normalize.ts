/**
 * Turns raw Sleeper responses into Snap Count's domain model.
 *
 * The fiddly parts of Sleeper's format, all handled here so no view has to know
 * about them:
 *
 *  - `roster.starters` is *positional*: index N is the Nth non-bench slot in
 *    `league.roster_positions`. An empty slot is the literal string "0".
 *  - Team defenses use the NFL abbreviation as the player id ("BAL"), not a
 *    numeric id, and their record has no `full_name`.
 *  - Points live on the matchup, not the roster: `players_points` is a map and
 *    `starters_points` is a parallel array to `starters`.
 *  - Per-player nicknames hide in `roster.metadata` under `p_nick_<player_id>`.
 *  - Season totals are split into integer and decimal halves (`fpts` +
 *    `fpts_decimal`) which must be recombined.
 */
import type {
  LeagueTeam,
  MyTeam,
  Platform,
  RosterPlayer,
  LeagueFormat,
  RosterSlotKind,
  WaiverMode,
  WeekMatchup,
  WeeklyPoint,
} from "@/lib/domain/types";
import { startingSlots } from "@/lib/domain/positions";
import { consistencyFrom } from "@/lib/domain/analytics";
import { sumProjected } from "@/lib/domain/scoring";
import { sleeperAvatarUrl } from "./client";
import type {
  SleeperLeague,
  SleeperLeagueUser,
  SleeperMatchup,
  SleeperPlayer,
  SleeperRoster,
} from "./types";

export const PLATFORM: Platform = "sleeper";

/** Sleeper writes an unfilled starting slot as the string "0". */
const EMPTY_SLOT = "0";

/** Recombines Sleeper's split integer/decimal point totals. */
export function combinePoints(
  whole: number | null | undefined,
  decimal: number | null | undefined,
): number {
  return (whole ?? 0) + (decimal ?? 0) / 100;
}

/** The custom team name if the manager set one, else their display name. */
export function teamNameFor(
  user: SleeperLeagueUser | undefined,
  rosterId: number,
): string {
  const custom = user?.metadata?.team_name?.trim();
  if (custom) return custom;
  const display = user?.display_name?.trim();
  if (display) return display;
  return `Roster ${rosterId}`;
}

/**
 * Minimal player lookup the normaliser needs. Backed either by the live
 * /players/nfl dump or by the cached `players` table.
 */
export interface PlayerLookup {
  get(playerId: string): PlayerFacts | undefined;
}

export interface PlayerFacts {
  fullName: string;
  position: string;
  nflTeam: string;
  status: string;
  injuryBodyPart: string | null;
  depthChartOrder: number | null;
  searchRank: number | null;
  yearsExp: number | null;
  age: number | null;
}

/** Builds a lookup from Sleeper's raw player map. */
export function lookupFromSleeperPlayers(
  map: Record<string, SleeperPlayer>,
): PlayerLookup {
  return {
    get(playerId) {
      const p = map[playerId];
      if (!p) return undefined;
      return toPlayerFacts(p);
    },
  };
}

export function toPlayerFacts(p: SleeperPlayer): PlayerFacts {
  const name =
    p.full_name?.trim() ||
    [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
    p.player_id;
  return {
    fullName: name,
    position: p.position ?? p.fantasy_positions?.[0] ?? "—",
    nflTeam: p.team ?? "",
    // Sleeper leaves injury_status null for healthy players.
    status: p.injury_status?.trim() || p.status?.trim() || "Active",
    injuryBodyPart: p.injury_body_part ?? null,
    depthChartOrder: p.depth_chart_order ?? null,
    searchRank: p.search_rank ?? null,
    yearsExp: p.years_exp ?? null,
    age: p.age ?? null,
  };
}

/** Fallback for a player id we have no record of — never drop the row. */
function unknownPlayer(playerId: string): PlayerFacts {
  return {
    fullName: playerId,
    position: "—",
    nflTeam: "",
    status: "Active",
    injuryBodyPart: null,
    depthChartOrder: null,
    searchRank: null,
    yearsExp: null,
    age: null,
  };
}

interface BuildRosterArgs {
  roster: SleeperRoster;
  league: SleeperLeague;
  lookup: PlayerLookup;
  /** Per-player points for the viewed week, from the matchup payload. */
  playerPoints: Record<string, number>;
  /** Per-player points across every week pulled, for the consistency read. */
  seasonPoints: Record<string, number[]>;
  byeWeeks: Record<string, number>;
  /** Projected points for the viewed week, already scored for this league. */
  projections: Map<string, number | null>;
}

/**
 * Expands a Sleeper roster into domain players, resolving each one's lineup
 * slot. Walks `starters` positionally against the league's starting slots so a
 * player in the 7th starting slot is tagged FLEX rather than by their position.
 */
export function buildRoster({
  roster,
  league,
  lookup,
  playerPoints,
  seasonPoints,
  byeWeeks,
  projections,
}: BuildRosterArgs): RosterPlayer[] {
  const slots = startingSlots(league.roster_positions);
  const starterIds = roster.starters ?? [];
  const reserve = new Set(roster.reserve ?? []);
  const taxi = new Set(roster.taxi ?? []);

  /** playerId -> { slotPosition, slotIndex } for anyone in the lineup. */
  const starterSlots = new Map<string, { slotPosition: string; slotIndex: number }>();
  starterIds.forEach((playerId, index) => {
    if (!playerId || playerId === EMPTY_SLOT) return;
    starterSlots.set(playerId, {
      slotPosition: slots[index] ?? "FLEX",
      slotIndex: index,
    });
  });

  // `players` should be a superset of starters, but a mid-week transaction can
  // briefly leave a starter out of it — union both so nobody vanishes.
  const allIds = new Set<string>([...(roster.players ?? []), ...starterSlots.keys()]);

  const rows: RosterPlayer[] = [];
  for (const playerId of allIds) {
    const facts = lookup.get(playerId) ?? unknownPlayer(playerId);
    const starterSlot = starterSlots.get(playerId);

    let kind: RosterSlotKind;
    if (starterSlot) kind = "starter";
    else if (reserve.has(playerId)) kind = "ir";
    else if (taxi.has(playerId)) kind = "taxi";
    else kind = "bench";

    const nickname = roster.metadata?.[`p_nick_${playerId}`]?.trim() || null;
    const history = consistencyFrom(seasonPoints[playerId] ?? []);

    rows.push({
      id: playerId,
      name: facts.fullName,
      position: facts.position,
      nflTeam: facts.nflTeam,
      status: facts.status,
      injuryBodyPart: facts.injuryBodyPart,
      slotPosition: starterSlot?.slotPosition ?? (kind === "starter" ? "FLEX" : "BN"),
      slotIndex: starterSlot?.slotIndex ?? null,
      kind,
      starter: kind === "starter",
      points: playerPoints[playerId] ?? null,
      projectedPoints: projections.get(playerId) ?? null,
      byeWeek: facts.nflTeam ? (byeWeeks[facts.nflTeam] ?? null) : null,
      nickname,
      depthChartOrder: facts.depthChartOrder,
      searchRank: facts.searchRank,
      yearsExp: facts.yearsExp,
      age: facts.age,
      seasonAvgPoints: history.avg,
      seasonSamples: history.samples,
      consistency: history.consistency,
    });
  }

  return rows;
}

/**
 * Collects every week's per-player scoring for one roster, so consistency is
 * computed from real week-to-week variance rather than a placeholder.
 */
export function seasonPointsForRoster(
  matchupsByWeek: Map<number, SleeperMatchup[]>,
  rosterId: number,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const weekMatchups of matchupsByWeek.values()) {
    const m = weekMatchups.find((x) => x.roster_id === rosterId);
    if (!m?.players_points) continue;
    for (const [playerId, points] of Object.entries(m.players_points)) {
      (out[playerId] ??= []).push(points);
    }
  }
  return out;
}

/** Pulls the per-player point map for one roster out of a week's matchups. */
export function pointsForRoster(
  matchups: SleeperMatchup[] | null,
  rosterId: number,
): Record<string, number> {
  const m = matchups?.find((x) => x.roster_id === rosterId);
  return m?.players_points ?? {};
}

export function recordString(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/**
 * Sleeper's league `type`: 0 redraft, 1 keeper, 2 dynasty, 3 guillotine.
 *
 * The first three are documented; 3 is not, and was identified from the one
 * league here that reports it being an actual guillotine league. Anything
 * beyond these still returns null rather than being forced into a category.
 */
const SLEEPER_LEAGUE_TYPE: Record<number, LeagueFormat> = {
  0: "redraft",
  1: "keeper",
  2: "dynasty",
  3: "guillotine",
};

export function leagueFormat(
  settings: Record<string, number> | null | undefined,
): LeagueFormat | null {
  const type = settings?.type;
  return typeof type === "number" ? (SLEEPER_LEAGUE_TYPE[type] ?? null) : null;
}

/** Sleeper's `waiver_type`: 2 is FAAB, 0 and 1 are priority-list variants. */
const SLEEPER_WAIVER_TYPE_FAAB = 2;

export interface WaiverRules {
  mode: WaiverMode;
  /** Per-team season allowance, FAAB leagues only. */
  budget: number | null;
}

/**
 * Reads a league's waiver rules out of Sleeper's `settings` blob. Note that
 * `waiver_budget` is populated even in priority leagues, so the budget is only
 * meaningful once `waiver_type` says the league actually bids.
 */
export function waiverRules(
  settings: Record<string, number> | null | undefined,
): WaiverRules {
  const s = settings ?? {};
  if (s.waiver_type !== SLEEPER_WAIVER_TYPE_FAAB) {
    return { mode: "priority", budget: null };
  }
  return {
    mode: "faab",
    budget: typeof s.waiver_budget === "number" ? s.waiver_budget : null,
  };
}

/**
 * The per-team waiver fields, with whichever number the league does not use
 * left null rather than filled with a plausible-looking zero.
 */
export function teamWaiverState(
  rules: WaiverRules,
  budgetUsed: number | null | undefined,
  waiverPosition: number | null | undefined,
): Pick<LeagueTeam, "faabUsed" | "faabRemaining" | "waiverPosition"> {
  if (rules.mode !== "faab") {
    return {
      faabUsed: null,
      faabRemaining: null,
      waiverPosition: waiverPosition ?? null,
    };
  }
  // A team that has never bid reports no `waiver_budget_used` at all, which is
  // the same thing as having spent nothing.
  const used = budgetUsed ?? 0;
  return {
    faabUsed: used,
    faabRemaining: rules.budget != null ? Math.max(0, rules.budget - used) : null,
    waiverPosition: null,
  };
}

interface BuildLeagueArgs {
  league: SleeperLeague;
  users: SleeperLeagueUser[];
  rosters: SleeperRoster[];
  /** Matchups keyed by week, for every week we pulled. */
  matchupsByWeek: Map<number, SleeperMatchup[]>;
  viewedWeek: number;
  myUserId: string;
  lookup: PlayerLookup;
  byeWeeks: Record<string, number>;
  /** playerId -> projected points, pre-scored for this league. */
  projections: Map<string, number | null>;
}

/**
 * Builds the MyTeam view model for one league. Returns null when the account
 * does not actually own a roster in it (co-owned or spectator leagues).
 */
export function buildMyTeam({
  league,
  users,
  rosters,
  matchupsByWeek,
  viewedWeek,
  myUserId,
  lookup,
  byeWeeks,
  projections,
}: BuildLeagueArgs): MyTeam | null {
  const userById = new Map(users.map((u) => [u.user_id, u]));

  const mine = rosters.find(
    (r) => r.owner_id === myUserId || (r.co_owners ?? []).includes(myUserId),
  );
  if (!mine) return null;

  const viewedMatchups = matchupsByWeek.get(viewedWeek) ?? null;
  const matchupByRoster = new Map(
    (viewedMatchups ?? []).map((m) => [m.roster_id, m]),
  );

  const teamIdFor = (rosterId: number) =>
    `sleeper-${league.league_id}-${rosterId}`;

  const waiver = waiverRules(league.settings);

  /** Builds any roster in this league into a LeagueTeam. */
  const toLeagueTeam = (roster: SleeperRoster): LeagueTeam => {
    const user = roster.owner_id ? userById.get(roster.owner_id) : undefined;
    const s = roster.settings;
    const m = matchupByRoster.get(roster.roster_id);
    return {
      id: teamIdFor(roster.roster_id),
      platformTeamId: String(roster.roster_id),
      name: teamNameFor(user, roster.roster_id),
      ownerName: user?.display_name ?? null,
      avatar: sleeperAvatarUrl(user?.avatar),
      isMine: roster.roster_id === mine.roster_id,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      ties: s.ties ?? 0,
      record: recordString(s.wins ?? 0, s.losses ?? 0, s.ties ?? 0),
      pointsFor: combinePoints(s.fpts, s.fpts_decimal),
      pointsAgainst: combinePoints(s.fpts_against, s.fpts_against_decimal),
      roster: buildRoster({
        roster,
        league,
        lookup,
        playerPoints: m?.players_points ?? {},
        seasonPoints: seasonPointsForRoster(matchupsByWeek, roster.roster_id),
        byeWeeks,
        projections,
      }),
      weekScore: m?.points ?? null,
      weekProjected: null, // filled in just below, once the roster exists
      ...teamWaiverState(waiver, s.waiver_budget_used, s.waiver_position),
    };
  };

  const leagueTeams = rosters.map(toLeagueTeam);
  // Projected total is the sum over the starting lineup, and stays null when
  // nobody in it has a projection.
  for (const t of leagueTeams) {
    const values = t.roster.filter((p) => p.starter).map((p) => p.projectedPoints);
    t.weekProjected = values.some((v) => v != null) ? sumProjected(values) : null;
  }
  const myLeagueTeam = leagueTeams.find((t) => t.isMine)!;

  /* -- current week's matchup -- */
  let matchup: WeekMatchup | null = null;
  const myMatchup = matchupByRoster.get(mine.roster_id);
  if (myMatchup) {
    const oppRaw =
      myMatchup.matchup_id != null
        ? (viewedMatchups ?? []).find(
            (x) =>
              x.matchup_id === myMatchup.matchup_id &&
              x.roster_id !== mine.roster_id,
          )
        : undefined;
    const oppTeam = oppRaw
      ? leagueTeams.find((t) => t.platformTeamId === String(oppRaw.roster_id))
      : undefined;

    matchup = {
      week: viewedWeek,
      matchupId: myMatchup.matchup_id != null ? String(myMatchup.matchup_id) : null,
      mine: {
        teamId: myLeagueTeam.id,
        teamName: myLeagueTeam.name,
        score: myMatchup.points ?? null,
        projected: myLeagueTeam.weekProjected,
      },
      opponent:
        oppRaw && oppTeam
          ? {
              teamId: oppTeam.id,
              teamName: oppTeam.name,
              score: oppRaw.points ?? null,
              projected: oppTeam.weekProjected,
            }
          : null,
    };
  }

  /* -- weekly scoring history for the charts view -- */
  const weeklyPoints: WeeklyPoint[] = [];
  const weeks = [...matchupsByWeek.keys()].sort((a, b) => a - b);
  for (const week of weeks) {
    const weekMatchups = matchupsByWeek.get(week) ?? [];
    const mineThisWeek = weekMatchups.find((m) => m.roster_id === mine.roster_id);
    if (!mineThisWeek) continue;
    const opp =
      mineThisWeek.matchup_id != null
        ? weekMatchups.find(
            (x) =>
              x.matchup_id === mineThisWeek.matchup_id &&
              x.roster_id !== mine.roster_id,
          )
        : undefined;
    weeklyPoints.push({
      week,
      label: `W${week}`,
      points: mineThisWeek.points ?? null,
      opponentPoints: opp?.points ?? null,
    });
  }

  const roster = myLeagueTeam.roster;
  const s = mine.settings;

  return {
    id: myLeagueTeam.id,
    platform: PLATFORM,
    leagueId: `sleeper-${league.league_id}`,
    platformLeagueId: league.league_id,
    leagueName: league.name.trim(),
    leagueAvatar: sleeperAvatarUrl(league.avatar),
    season: league.season,
    leagueStatus: league.status ?? null,
    startingSlots: startingSlots(league.roster_positions),
    totalRosters: league.total_rosters ?? rosters.length,
    leagueFormat: leagueFormat(league.settings),
    waiverMode: waiver.mode,
    faabBudget: waiver.budget,

    teamName: myLeagueTeam.name,
    avatar: myLeagueTeam.avatar,
    wins: s.wins ?? 0,
    losses: s.losses ?? 0,
    ties: s.ties ?? 0,
    record: myLeagueTeam.record,
    pointsFor: myLeagueTeam.pointsFor,
    pointsAgainst: myLeagueTeam.pointsAgainst,

    roster,
    starters: roster.filter((p) => p.starter),
    bench: roster.filter((p) => !p.starter),

    matchup,
    weeklyPoints,
    leagueTeams,
  };
}
