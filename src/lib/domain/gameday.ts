/**
 * Gameday's domain model — what the live Sunday view consumes.
 *
 * Separate from `types.ts` on purpose. The dashboard's model is season-shaped:
 * rosters, records, weekly points, a matchup you look at once. Gameday's is
 * clock-shaped, and the two want different things from the same underlying
 * data. Forcing both through `MyTeam` would mean every gameday component
 * carrying fields it never reads and re-deriving the ones it does.
 *
 * The envelope at the bottom mirrors `DashboardData` — `generatedAt`, `source`,
 * `warnings` — so the failure behaviour is the same one the rest of the app
 * already has: a league that could not be read degrades to a warning rather
 * than taking the page down.
 */
import type { LeagueFormat, NflStateView, Platform } from "./types";

/* -------------------------------------------------------------------------
   NFL games
   ------------------------------------------------------------------------- */

/**
 * ESPN's three states, kept in its own vocabulary rather than translated.
 *
 * "pre" and "post" are unambiguous; "in" is the one that matters, because it
 * is the only state in which `situation` exists at all.
 */
export type GameState = "pre" | "in" | "post";

/** One side of an NFL game. */
export interface NflGameTeam {
  /** Normalised through `normalizeEspnAbbr`, so it joins to `players.nflTeam`. */
  abbr: string;
  name: string;
  /** Null before kickoff — ESPN reports "0" pregame, which is not the same thing. */
  score: number | null;
  /** e.g. "2-0". Null in week 1, where nobody has a record yet. */
  record: string | null;
}

/**
 * The live-only half of a game.
 *
 * Every field here is absent from a completed or unstarted game, which is why
 * this is a nullable object rather than optional fields on `NflGame` — a
 * component that has a `situation` can render all of it without null-checking
 * each field, and one that does not gets a single branch.
 */
export interface NflGameSituation {
  /** ESPN's own `displayClock`, e.g. "2:47". Not parsed — only displayed. */
  clock: string;
  period: number;
  /** e.g. "3rd & 7". Null on a kickoff or between possessions. */
  downDistance: string | null;
  /** Abbreviation of the team with the ball, normalised. */
  possession: string | null;
  /** ESPN's own flag. The whole red-zone radar hangs off this. */
  isRedZone: boolean;
  lastPlay: string | null;
}

export interface NflGame {
  /** ESPN event id. The drill-in route is keyed on this. */
  eventId: string;
  /** e.g. "WSH @ GB". */
  shortName: string;
  /** ISO kickoff time. Rendered in the viewer's zone, never a fixed one. */
  kickoff: string;
  state: GameState;
  /** ESPN's own phrasing: "Final", "3rd Quarter", "1:00 PM". */
  statusDetail: string;
  home: NflGameTeam;
  away: NflGameTeam;
  /** Present only while `state === "in"`. */
  situation: NflGameSituation | null;
  /** Network name, when ESPN reports one. */
  broadcast: string | null;
}

/* -------------------------------------------------------------------------
   Rooting interest — the hero
   ------------------------------------------------------------------------- */

/**
 * Leverage-weighted, or the raw point swing behind it.
 *
 * Both are computed and shipped together rather than the client refetching on
 * toggle: the expensive part is the fan-out, not the arithmetic, and a toggle
 * that waits on a network round-trip feels broken.
 */
export type RootingMode = "leverage" | "raw";

/** One league's contribution to a game's rooting interest. */
export interface RootingContribution {
  leagueId: string;
  leagueName: string;
  platform: Platform;
  /** Positive = this game helps you here, negative = it hurts. */
  net: number;
  /** How many of your starters are in this game. */
  mineInGame: number;
  /** How many of your opponent's are. Always 0 in a survival league. */
  opponentInGame: number;
}

export interface RootingInterest {
  eventId: string;
  /** Net swing in this mode's units: win-probability points, or fantasy points. */
  net: number;
  /**
   * 0..1, scaled against the strongest interest on the slate.
   *
   * Relative rather than absolute because the absolute numbers are not
   * meaningful to a reader — what they want to know is which games matter
   * *most today*, and that is a comparison.
   */
  strength: number;
  direction: "for" | "against" | "neutral";
  /**
   * Which NFL team to root for, when there is one. Null when the interest is
   * neutral, or when it is genuinely split down the middle.
   */
  rootFor: string | null;
  /**
   * True when the same game helps you in one league and hurts you in another —
   * the state no single-league app can tell you about, and the reason this
   * whole feature exists.
   */
  conflicted: boolean;
  /** Biggest absolute contribution first. */
  contributions: RootingContribution[];
}

/* -------------------------------------------------------------------------
   Live matchups
   ------------------------------------------------------------------------- */

/**
 * One team's live position.
 *
 * `score` is never computed here — it is whatever the platform says, because a
 * number that disagrees with the Sleeper app by 0.2 makes the whole page
 * untrustworthy. `remaining` is ours, and is a projection, and is labelled as
 * one wherever it appears.
 */
export interface LiveMatchupSide {
  teamId: string;
  teamName: string;
  avatar: string | null;
  /** The platform's own live total. */
  score: number;
  /** Sum of projections for starters who have not played yet. */
  remaining: number;
  /** Starters whose game has not kicked off. */
  yetToPlay: number;
  /** Starters whose game is in progress. */
  inProgress: number;
  /** Starters whose game is final. */
  done: number;
}

/** A team's live score within its league, for the league-wide strip. */
export interface LiveLeagueRow {
  teamId: string;
  teamName: string;
  isMine: boolean;
  score: number;
  remaining: number;
  yetToPlay: number;
}

export interface LiveMatchup {
  leagueId: string;
  leagueName: string;
  leagueAvatar: string | null;
  platform: Platform;
  leagueFormat: LeagueFormat | null;
  week: number;
  mine: LiveMatchupSide;
  /**
   * Null in a survival format. Guillotine has no head-to-head at all — its 18
   * matchup rows carry no opponent, by design, because the whole league plays
   * the field. Anything reading this must branch rather than assume.
   */
  opponent: LiveMatchupSide | null;
  /**
   * 0..1. Null when there is no opponent to model against, in which case
   * `survival` carries the equivalent number.
   */
  winProbability: number | null;
  /**
   * Survival formats only: the probability of *not* finishing last this week.
   * Null in a head-to-head league.
   */
  survival: number | null;
  /** 1 = highest live score in the league. */
  liveRank: number;
  totalTeams: number;
  /** Every team in the league by live score, highest first. */
  standings: LiveLeagueRow[];
}

/* -------------------------------------------------------------------------
   The envelope
   ------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
   Game drill-in
   ------------------------------------------------------------------------- */

/** One player's line in a box score, already joined to our roster data. */
export interface BoxScorePlayer {
  /** Canonical player id when we could resolve them, else null. */
  playerId: string | null;
  name: string;
  /** Values aligned to the category's `labels`. */
  stats: string[];
  /** True when this player starts for you somewhere. */
  mine: boolean;
  /** True when they start for a team you are facing this week. */
  against: boolean;
}

/** A box-score category — passing, rushing, receiving and so on. */
export interface BoxScoreCategory {
  name: string;
  labels: string[];
  players: BoxScorePlayer[];
}

export interface BoxScoreTeam {
  abbr: string;
  categories: BoxScoreCategory[];
}

/** A scoring play, in ESPN's own prose. */
export interface ScoringPlay {
  id: string;
  text: string;
  team: string;
  period: number;
  clock: string;
  awayScore: number;
  homeScore: number;
  /** True when a player you start was involved — resolved by athlete id. */
  involvesMine: boolean;
}

export interface DriveSummary {
  id: string;
  team: string;
  result: string;
  description: string;
  plays: number;
  isScore: boolean;
}

/**
 * One point on the win-probability curve.
 *
 * ESPN indexes these by play, not by clock — the entries carry a `playId` and
 * no timestamp — so the x-axis is play sequence. Plotting it against time
 * would require joining every point back to its play, for a chart whose shape
 * is the same either way.
 */
export interface WinProbabilityPoint {
  index: number;
  homeWinPercentage: number;
}

/** One play, annotated with which of your leagues it moves. */
export interface PlayEvent {
  id: string;
  text: string;
  team: string;
  period: number;
  clock: string;
  scoringPlay: boolean;
  /** Net yards, when ESPN reports them. */
  yards: number | null;
  /** True when the play actually changed something — see the feed filter. */
  consequential: boolean;
  involved: Array<{
    playerId: string;
    espnId: string;
    roles: Array<{ leagueId: string; leagueName: string; side: "mine" | "against" }>;
  }>;
}

/** Everything the drill-in shows for one game. */
export interface GameDetail {
  eventId: string;
  shortName: string;
  state: GameState;
  statusDetail: string;
  home: NflGameTeam;
  away: NflGameTeam;
  situation: NflGameSituation | null;
  boxScore: BoxScoreTeam[];
  scoringPlays: ScoringPlay[];
  drives: DriveSummary[];
  winProbability: WinProbabilityPoint[];
  /** Plays involving players you have a stake in, newest first. */
  plays: PlayEvent[];
  warnings: string[];
}

/**
 * A starter you should look at before kickoff.
 *
 * The 11:55 problem: locks are coming, and the thing you need is not a score
 * but a list of who is questionable across nine lineups at once. Checking that
 * league by league is exactly the chore this app exists to remove.
 */
export interface LineupAlert {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string;
  /** Questionable | Doubtful | Out | IR, in the platform is own words. */
  status: string;
  /** Every league you START them in. Bench spots are not a problem. */
  leagues: Array<{ leagueId: string; leagueName: string }>;
  /** Their game is kickoff, so the most urgent sorts first. */
  kickoff: string | null;
  gameState: GameState | null;
}

/**
 * Which NFL teams you have a stake in, and how big.
 *
 * Keyed by NFL team abbreviation, already normalised so it matches the game
 * feed. Plain records rather than Maps because this crosses a JSON boundary —
 * a Map serialises to `{}` and the loss is silent.
 *
 * This is what lets the red-zone radar fire only for drives that matter to
 * you. ESPN's own flag would light up a third of the slate for games you have
 * nobody in, which is how an alert turns into noise.
 */
export interface RosterPresence {
  /** NFL team -> how many of your starters play for it, across all leagues. */
  mine: Record<string, number>;
  /** Same for the teams your opponents start this week. */
  against: Record<string, number>;
}

/** Everything `/gameday` loads in one poll. */
export interface GamedayData {
  state: NflStateView;
  viewedWeek: number;
  /**
   * ISO time this payload was assembled, which is what "updated Xs ago" reads.
   *
   * Deliberately not `lastSyncedAt`: gameday never reads the sync cache for
   * scores, so there is no sync time to report. Naming it differently keeps
   * anyone from wiring a staleness indicator to the wrong clock.
   */
  generatedAt: string;
  /** True when at least one game is in progress — drives the poll cadence. */
  anyLive: boolean;
  games: NflGame[];
  matchups: LiveMatchup[];
  /** Both modes, so the toggle is instant. Each is sorted strongest first. */
  rooting: Record<RootingMode, RootingInterest[]>;
  /** Your stake in each NFL team, for the red-zone radar and game cards. */
  presence: RosterPresence;
  /** Starters with an injury designation, most urgent first. */
  alerts: LineupAlert[];
  /**
   * Always "live". Present so the shape matches `DashboardData` and so a future
   * snapshot-replay path has somewhere to say it is showing history.
   */
  source: "live";
  /** Non-fatal problems worth surfacing — a league whose scores failed to load. */
  warnings: string[];
}
