/**
 * Snap Count's platform-agnostic domain model.
 *
 * Every view consumes these types and nothing else. The prototype branched on
 * `team.platform === "sleeper"` in a dozen places to decide whether a roster was
 * an array of ids or an array of objects; normalising at the edge means views
 * never ask which platform a team came from except to render its badge.
 */

export type Platform = "sleeper" | "yahoo" | "espn";

export type RosterSlotKind = "starter" | "bench" | "ir" | "taxi";

/** A player as the UI needs them — already joined to the player dimension. */
export interface RosterPlayer {
  /** Canonical player id. */
  id: string;
  name: string;
  /** QB | RB | WR | TE | K | DEF ... */
  position: string;
  /** NFL team abbreviation, e.g. "SF". Empty for unmapped players. */
  nflTeam: string;
  /** Active | Questionable | Doubtful | Out | IR ... */
  status: string;
  injuryBodyPart: string | null;
  /** Lineup slot this player occupies: "QB", "FLEX", "SUPER_FLEX", "BN". */
  slotPosition: string | null;
  slotIndex: number | null;
  kind: RosterSlotKind;
  starter: boolean;
  /** Points scored in the currently-viewed week, when the platform reports it. */
  points: number | null;
  /**
   * Projected points for the viewed week, scored against this league's own
   * scoring settings. Null when no projection exists — Sleeper only projects
   * fantasy-relevant players, so deep bench and taxi spots legitimately have
   * none, and showing 0.0 there would be a lie.
   */
  projectedPoints: number | null;
  /** Bye week for this player's NFL team this season, when known. */
  byeWeek: number | null;
  /** Owner-assigned nickname, if the platform supports them. */
  nickname: string | null;
  depthChartOrder: number | null;
  searchRank: number | null;
  yearsExp: number | null;
  age: number | null;
  /** Mean fantasy points across weeks played this season, null before kickoff. */
  seasonAvgPoints: number | null;
  /** Weeks of scoring behind seasonAvgPoints/consistency. */
  seasonSamples: number;
  /**
   * Real week-to-week volatility, not a placeholder. Null until there are
   * enough weeks played to say anything — the prototype faked this with a hash.
   */
  consistency: Consistency | null;
}

export type Consistency = "Boom" | "Steady" | "Volatile";

/**
 * How a league awards free agents. The distinction is load-bearing: a budget
 * is meaningless in a priority league and a priority number is meaningless in
 * a FAAB one, so a view that shows both unconditionally is lying about one of
 * them. Sleeper encodes this as `waiver_type` — 2 is FAAB, 0 and 1 are rolling
 * and reverse-standings priority lists.
 */
export type WaiverMode = "faab" | "priority";

/** Any team in a league, including opponents. */
export interface LeagueTeam {
  id: string;
  platformTeamId: string;
  name: string;
  ownerName: string | null;
  avatar: string | null;
  isMine: boolean;
  wins: number;
  losses: number;
  ties: number;
  record: string;
  pointsFor: number;
  pointsAgainst: number;
  roster: RosterPlayer[];
  /** Score in the currently-viewed week, null before kickoff. */
  weekScore: number | null;
  /** Projected total for the viewed week's starting lineup. */
  weekProjected: number | null;
  /** FAAB spent this season. Null in priority leagues, which have no budget. */
  faabUsed: number | null;
  /** Budget left to bid with. Null in priority leagues, or if none is set. */
  faabRemaining: number | null;
  /** Rolling waiver priority, 1 = next claim. Null in FAAB leagues. */
  waiverPosition: number | null;
}

export interface MatchupSide {
  teamId: string;
  teamName: string;
  score: number | null;
  /** Sum of the starting lineup's projections. Null if nothing is projected. */
  projected: number | null;
}

export interface WeekMatchup {
  week: number;
  matchupId: string | null;
  mine: MatchupSide;
  opponent: MatchupSide | null;
}

/**
 * One row of a head-to-head lineup comparison: the same lineup slot on both
 * sides. Either side can be empty when league lineups differ in length (they
 * should not, but an unfilled slot is real).
 */
export interface MatchupSlotRow {
  slot: string;
  slotIndex: number;
  mine: RosterPlayer | null;
  opponent: RosterPlayer | null;
}

/** Everything the head-to-head view needs for one matchup. */
export interface MatchupDetail {
  teamId: string;
  leagueId: string;
  leagueName: string;
  platform: Platform;
  week: number;
  season: string;
  matchupId: string | null;

  mine: MatchupTeamView;
  opponent: MatchupTeamView | null;

  /** Starting lineups aligned slot by slot. */
  slots: MatchupSlotRow[];
  /** True when at least one player on either side has a projection. */
  hasProjections: boolean;
}

export interface MatchupTeamView {
  id: string;
  name: string;
  ownerName: string | null;
  avatar: string | null;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  score: number | null;
  projected: number | null;
  starters: RosterPlayer[];
  bench: RosterPlayer[];
}

/** A weekly scoring datapoint for the charts view. */
export interface WeeklyPoint {
  week: number;
  label: string;
  points: number | null;
  opponentPoints: number | null;
}

/**
 * The central view model: one of *your* teams, with everything a view needs
 * about it and the league around it.
 */
export interface MyTeam {
  id: string;
  platform: Platform;
  leagueId: string;
  platformLeagueId: string;
  leagueName: string;
  /** League avatar URL from the platform CDN, when it has one. */
  leagueAvatar: string | null;
  season: string;
  /** pre_draft | drafting | in_season | complete */
  leagueStatus: string | null;
  /** Ordered starting slots, bench excluded: ["QB","RB","RB","WR",...]. */
  startingSlots: string[];
  totalRosters: number;
  /** How this league awards free agents. */
  waiverMode: WaiverMode;
  /** Each team's season FAAB allowance. Null unless waiverMode is "faab". */
  faabBudget: number | null;

  teamName: string;
  avatar: string | null;
  wins: number;
  losses: number;
  ties: number;
  record: string;
  pointsFor: number;
  pointsAgainst: number;

  roster: RosterPlayer[];
  starters: RosterPlayer[];
  bench: RosterPlayer[];

  matchup: WeekMatchup | null;
  weeklyPoints: WeeklyPoint[];
  /** Every other team in this league, rosters included. */
  leagueTeams: LeagueTeam[];
}

export interface TrendingPlayer {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string;
  count: number;
  /** True when someone in your leagues already rosters them. */
  rostered: boolean;
}

export interface DraftPickView {
  pickNo: number;
  round: number;
  draftSlot: number | null;
  playerId: string | null;
  playerName: string;
  position: string;
  nflTeam: string;
  pickedBy: string;
  isKeeper: boolean;
}

export interface DraftView {
  leagueId: string;
  leagueName: string;
  season: string;
  status: string | null;
  rounds: number | null;
  picks: DraftPickView[];
}

export interface NflStateView {
  season: string;
  seasonType: string;
  week: number;
  displayWeek: number;
  /** True once regular-season games are actually being played. */
  inSeason: boolean;
}

/** Everything the dashboard loads in one shot. */
export interface DashboardData {
  state: NflStateView;
  /** The week the UI is currently showing. */
  viewedWeek: number;
  teams: MyTeam[];
  trending: TrendingPlayer[];
  drafts: DraftView[];
  byeWeeks: Record<string, number>;
  /** When the underlying cache was last refreshed, null in live mode. */
  lastSyncedAt: string | null;
  /** "cache" when served from Postgres, "live" when fetched from the API. */
  source: "cache" | "live";
  /** Non-fatal problems worth surfacing (a league that failed to sync, etc). */
  warnings: string[];
}
