/**
 * The derived numbers behind Power Rankings, position grades, start/sit flags
 * and waiver suggestions.
 *
 * The prototype computed these from a deterministic hash of the player id
 * because it had no real data. Everything here runs on genuine signals instead:
 * Sleeper's own overall player ranking, actual season point totals, and real
 * opponent rosters in the same league. Where a real signal does not exist yet
 * (week-to-week variance before any games are played) the function returns null
 * and the view renders an honest empty state rather than an invented number.
 */
import type {
  Consistency,
  LeagueTeam,
  MyTeam,
  RosterPlayer,
} from "./types";
import { GRADE_POSITIONS, type GradePosition } from "./positions";

/* -------------------------------------------------------------------------
   Player value
   ------------------------------------------------------------------------- */

/**
 * A 0-100 value score for a player.
 *
 * Sleeper's `search_rank` is its own overall fantasy ordering (1 = best, and
 * ~9999999 for irrelevant players), which makes it the best free proxy for
 * player value available without a paid rankings feed. Season scoring nudges
 * the number once games have been played, so a breakout climbs above their
 * preseason rank.
 */
export function playerValue(player: RosterPlayer): number {
  const rank = player.searchRank;

  // Rank 1 -> ~100, rank 200 -> ~30, beyond ~600 -> near 0.
  let base = 0;
  if (rank != null && rank > 0 && rank < 100_000) {
    base = Math.max(0, 100 * Math.exp(-rank / 180));
  }

  // Once there is real scoring, blend it in: 15 ppg is roughly a strong
  // starter, so scale to the same 0-100 range and weight by sample size.
  if (player.seasonAvgPoints != null && player.seasonSamples > 0) {
    const scored = Math.min(100, (player.seasonAvgPoints / 20) * 100);
    const weight = Math.min(0.6, player.seasonSamples * 0.12);
    base = base * (1 - weight) + scored * weight;
  }

  // An out player is worth nothing to this week's lineup.
  if (player.status === "Out" || player.status === "IR") base *= 0.35;
  else if (player.status === "Doubtful") base *= 0.6;
  else if (player.status === "Questionable") base *= 0.85;

  return Math.round(base * 10) / 10;
}

/* -------------------------------------------------------------------------
   Consistency
   ------------------------------------------------------------------------- */

/** Weeks of scoring needed before calling a player boom-or-bust. */
export const MIN_CONSISTENCY_SAMPLES = 3;

/**
 * Classifies week-to-week variance using the coefficient of variation, so the
 * label is scale-free — a 3-point swing means something different for a QB than
 * for a kicker. Returns null when there is not enough of a sample.
 */
export function consistencyFrom(points: number[]): {
  avg: number | null;
  consistency: Consistency | null;
  samples: number;
} {
  const played = points.filter((p) => Number.isFinite(p));
  if (played.length === 0) return { avg: null, consistency: null, samples: 0 };

  const avg = played.reduce((s, p) => s + p, 0) / played.length;

  if (played.length < MIN_CONSISTENCY_SAMPLES || avg <= 0) {
    return { avg: round1(avg), consistency: null, samples: played.length };
  }

  const variance =
    played.reduce((s, p) => s + (p - avg) ** 2, 0) / played.length;
  const cv = Math.sqrt(variance) / avg;

  const consistency: Consistency =
    cv >= 0.65 ? "Volatile" : cv <= 0.35 ? "Steady" : "Boom";

  return { avg: round1(avg), consistency, samples: played.length };
}

export const CONSISTENCY_COLOR: Record<Consistency, string> = {
  Boom: "#4C9A5B",
  Steady: "#8B95A1",
  Volatile: "#D9534F",
};

/* -------------------------------------------------------------------------
   Position grades
   ------------------------------------------------------------------------- */

export interface Grade {
  letter: "A" | "B" | "C" | "D" | "F";
  /** Share of teams in the league this team is at or above at the position. */
  percentile: number;
  /** Total positional value on this roster. */
  value: number;
  /** League-average positional value, for context. */
  leagueAverage: number;
}

export type TeamGrades = Record<GradePosition, Grade>;

function letterFor(percentile: number): Grade["letter"] {
  if (percentile >= 0.8) return "A";
  if (percentile >= 0.6) return "B";
  if (percentile >= 0.4) return "C";
  if (percentile >= 0.2) return "D";
  return "F";
}

function positionalValue(roster: RosterPlayer[], pos: string): number {
  return roster
    .filter((p) => p.position === pos && p.kind !== "taxi")
    .reduce((sum, p) => sum + playerValue(p), 0);
}

/**
 * Grades a team at each position against every other real roster in the same
 * league — the same idea as the prototype, but the comparison set is now the
 * actual competition rather than generated opponents.
 */
export function computeTeamGrades(team: MyTeam): TeamGrades {
  const rosters: RosterPlayer[][] = team.leagueTeams.map((t) => t.roster);
  const mine = team.roster;

  const grades = {} as TeamGrades;

  for (const pos of GRADE_POSITIONS) {
    const myValue = positionalValue(mine, pos);
    const allValues = rosters.map((r) => positionalValue(r, pos));
    const leagueAverage =
      allValues.length > 0
        ? allValues.reduce((s, v) => s + v, 0) / allValues.length
        : 0;

    const atOrBelow = allValues.filter((v) => v <= myValue).length;
    const percentile = allValues.length > 1 ? atOrBelow / allValues.length : 0.5;

    grades[pos] = {
      letter: letterFor(percentile),
      percentile,
      value: round1(myValue),
      leagueAverage: round1(leagueAverage),
    };
  }

  return grades;
}

/** The position where a team is weakest relative to its league. */
export function weakestPosition(grades: TeamGrades): {
  pos: GradePosition;
  grade: Grade;
} {
  const entries = GRADE_POSITIONS.map((pos) => ({ pos, grade: grades[pos] }));
  entries.sort((a, b) => a.grade.percentile - b.grade.percentile);
  return entries[0];
}

/* -------------------------------------------------------------------------
   Power ranking
   ------------------------------------------------------------------------- */

/**
 * Blends win rate with scoring margin. Before any games are played both are
 * zero for everyone, so roster strength carries the ranking instead — otherwise
 * every team would tie at preseason.
 */
export function compositeScore(team: MyTeam): number {
  const games = team.wins + team.losses + team.ties;
  const rosterStrength = averageStarterValue(team);

  if (games === 0) return rosterStrength;

  const winPct = (team.wins + team.ties * 0.5) / games;
  const margin = team.pointsFor - team.pointsAgainst;
  const perGameMargin = margin / games;

  return (
    winPct * 60 +
    Math.max(-20, Math.min(20, perGameMargin / 2)) +
    rosterStrength * 0.3
  );
}

/** Mean value of a team's starting lineup — the roster-strength signal. */
export function averageStarterValue(team: MyTeam): number {
  const starters = team.starters;
  if (starters.length === 0) return 0;
  const total = starters.reduce((s, p) => s + playerValue(p), 0);
  return round1(total / starters.length);
}

/**
 * A rough playoff-odds estimate. Explicitly not a season simulation — the view
 * says as much — but it now reacts to real record, real margin, and how many
 * teams the league actually takes to the postseason.
 */
export function playoffOdds(team: MyTeam): number | null {
  const games = team.wins + team.losses + team.ties;
  if (games === 0) return null;

  const winPct = (team.wins + team.ties * 0.5) / games;
  const perGameMargin = (team.pointsFor - team.pointsAgainst) / games;

  // Baseline is the share of the league that makes the playoffs, nudged by
  // record and scoring margin.
  const playoffTeams = Math.max(2, Math.round(team.totalRosters / 2));
  const baseline = (playoffTeams / team.totalRosters) * 100;

  const odds = baseline + (winPct - 0.5) * 90 + perGameMargin * 1.5;
  return Math.max(2, Math.min(98, Math.round(odds)));
}

export interface Tier {
  label: string;
  color: string;
}

export function tierFor(rank: number, total: number): Tier {
  if (rank < Math.ceil(total * 0.34)) return { label: "Contender", color: "#4C9A5B" };
  if (rank < Math.ceil(total * 0.67)) return { label: "Bubble", color: "#F2A63D" };
  return { label: "Rebuilding", color: "#D9534F" };
}

/* -------------------------------------------------------------------------
   Start / sit
   ------------------------------------------------------------------------- */

export interface LineupFlag {
  starter: RosterPlayer;
  replacement: RosterPlayer;
  /** How much value the swap gains. */
  delta: number;
  reason: string;
}

/** Bench players are only swappable into a slot they are eligible for. */
const FLEX_ELIGIBLE: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

function eligibleForSlot(slot: string | null, position: string): boolean {
  if (!slot) return false;
  const flex = FLEX_ELIGIBLE[slot];
  if (flex) return flex.includes(position);
  if (slot === "DEF" || slot === "DST") return position === "DEF" || position === "DST";
  return slot === position;
}

/**
 * Flags starters a bench player would plausibly outscore, respecting real
 * lineup eligibility — a bench WR can take a FLEX slot but not a QB slot, which
 * the prototype's same-position-only check got wrong for flex leagues.
 *
 * An injured starter is always worth flagging even when the bench option grades
 * lower, because a player ruled Out will score zero.
 */
export function lineupFlags(team: MyTeam): LineupFlag[] {
  const bench = team.bench.filter((p) => p.kind === "bench");
  const flags: LineupFlag[] = [];
  const used = new Set<string>();

  for (const starter of team.starters) {
    const starterValue = playerValue(starter);
    const candidates = bench
      .filter((b) => !used.has(b.id))
      .filter((b) => eligibleForSlot(starter.slotPosition, b.position))
      .filter((b) => b.status !== "Out" && b.status !== "IR")
      .map((b) => ({ player: b, value: playerValue(b) }))
      .sort((a, b) => b.value - a.value);

    const best = candidates[0];
    if (!best) continue;

    const injured = starter.status === "Out" || starter.status === "IR";
    const onBye =
      starter.byeWeek != null && starter.byeWeek === team.matchup?.week;
    const clearlyBetter = best.value > starterValue * 1.08;

    if (!injured && !onBye && !clearlyBetter) continue;

    used.add(best.player.id);
    flags.push({
      starter,
      replacement: best.player,
      delta: round1(best.value - starterValue),
      reason: injured
        ? `${starter.name} is listed ${starter.status}`
        : onBye
          ? `${starter.name} is on bye this week`
          : `${best.player.name} grades higher at ${starter.slotPosition}`,
    });
  }

  return flags.sort((a, b) => b.delta - a.delta);
}

/* -------------------------------------------------------------------------
   Trade value
   ------------------------------------------------------------------------- */

export interface TradeRead {
  outgoing: number;
  incoming: number;
  /** Positive means the other side gets more value. */
  diff: number;
  verdict: string;
  balanced: boolean;
}

export function evaluateTrade(
  outgoing: RosterPlayer[],
  incoming: RosterPlayer[],
  myTeamName: string,
  theirTeamName: string,
): TradeRead {
  const out = outgoing.reduce((s, p) => s + playerValue(p), 0);
  const inc = incoming.reduce((s, p) => s + playerValue(p), 0);
  const diff = out - inc;
  const scale = Math.max(out, inc, 1);
  const balanced = Math.abs(diff) / scale < 0.1;

  return {
    outgoing: round1(out),
    incoming: round1(inc),
    diff: round1(diff),
    balanced,
    verdict: balanced
      ? "Roughly balanced on value."
      : diff > 0
        ? `Leans toward ${theirTeamName} by about ${round1(Math.abs(diff))} points of value.`
        : `Leans toward ${myTeamName} by about ${round1(Math.abs(diff))} points of value.`,
  };
}

/* -------------------------------------------------------------------------
   Selection helpers
   ------------------------------------------------------------------------- */

/**
 * The team a view should land on when nothing is selected.
 *
 * Teams are listed alphabetically by league, and a pre-draft league sorts to
 * the top just as readily as an active one — landing on an empty roster makes
 * the app look broken. Prefer a team that actually has players.
 */
export function defaultTeam(teams: MyTeam[]): MyTeam | undefined {
  return teams.find((t) => t.roster.length > 0) ?? teams[0];
}

/* -------------------------------------------------------------------------
   Standings
   ------------------------------------------------------------------------- */

/** League standings ordered the way fantasy platforms do: record, then PF. */
export function sortStandings(teams: LeagueTeam[]): LeagueTeam[] {
  return [...teams].sort((a, b) => {
    const aPct = winPct(a);
    const bPct = winPct(b);
    if (bPct !== aPct) return bPct - aPct;
    return b.pointsFor - a.pointsFor;
  });
}

function winPct(t: { wins: number; losses: number; ties: number }): number {
  const games = t.wins + t.losses + t.ties;
  if (games === 0) return 0;
  return (t.wins + t.ties * 0.5) / games;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export { round1 };
