/**
 * Which games to root for, and how badly.
 *
 * The problem this solves is specific to owning a lot of teams. Across nine
 * leagues, 75 of the user's starter slots span 31 of the 32 NFL teams, and
 * their opponents' 67 span 29 — so nearly every game on the board contains
 * something of theirs and something against them. A plain "net projected
 * points" reading therefore labels all thirteen games *mixed* and tells the
 * reader nothing.
 *
 * What makes the number mean something is weighting each league's swing by how
 * much a point actually moves the needle *there*: a league already won by 40
 * should contribute nothing, and a two-point game should dominate. That weight
 * is the derivative of win probability with respect to points — leverage.
 *
 * Everything here is pure. No I/O, no database, no clock. `data/gameday.ts`
 * maps rows onto these inputs; this file only does arithmetic, which is what
 * makes it the one part of gameday that can be unit-tested properly.
 *
 * THIS IS A MODEL. It assumes each side's remaining points are normally
 * distributed and independent, which is wrong in the ways all such assumptions
 * are wrong (a QB and his own receiver are correlated; a blowout changes how a
 * team plays). It is honest about direction and rough about magnitude.
 *
 * Two things are therefore required of anything that renders it, neither of
 * which is enforceable from here: say on screen that it is a model, and keep
 * the raw point swing reachable — `rootingInterest` computes both modes for
 * exactly that reason, so a reader who distrusts the weighting can see the
 * unweighted truth without a refetch.
 */
import type {
  GameState,
  RootingContribution,
  RootingInterest,
  RootingMode,
} from "./gameday";
import type { Platform } from "./types";

/* -------------------------------------------------------------------------
   The model's constants — one auditable place, deliberately not inlined
   ------------------------------------------------------------------------- */

/**
 * Week-to-week standard deviation of a starter's fantasy points, by position.
 *
 * These are judgement, not fitted values: they encode that a kicker's week is
 * narrow, a wide receiver's is wide, and a tight end sits between. Fitting them
 * to real per-week distributions is a genuine improvement available later — the
 * point of naming them here is that doing so is a one-line change rather than
 * an archaeology exercise.
 */
const POSITION_SIGMA: Record<string, number> = {
  QB: 7,
  RB: 7,
  WR: 8,
  TE: 5,
  K: 4,
  DEF: 7,
  DST: 7,
};

/** Anything unrecognised — IDP slots, exotic positions — gets the middle. */
const DEFAULT_SIGMA = 6;

/**
 * Fallback projection for a starter with no projection row.
 *
 * About 4% of starters have none: Sleeper only projects fantasy-relevant
 * players, so deep-league starters legitimately lack one. Contributing 0 would
 * quietly claim a starter is going to score nothing, which skews every number
 * downstream — a position average is wrong by less and is wrong honestly.
 */
const POSITION_FALLBACK: Record<string, number> = {
  QB: 15,
  RB: 9,
  WR: 9,
  TE: 6,
  K: 7,
  DEF: 6,
  DST: 6,
};

const DEFAULT_FALLBACK = 6;

/** Step used for numeric derivatives, in fantasy points. */
const LEVERAGE_STEP = 1;

export function positionSigma(position: string): number {
  return POSITION_SIGMA[position.toUpperCase()] ?? DEFAULT_SIGMA;
}

export function fallbackProjection(position: string): number {
  return POSITION_FALLBACK[position.toUpperCase()] ?? DEFAULT_FALLBACK;
}

/* -------------------------------------------------------------------------
   Normal distribution
   ------------------------------------------------------------------------- */

const INV_SQRT_2PI = 0.3989422804014327;

/**
 * Standard normal CDF, Abramowitz & Stegun 26.2.17 (|error| < 7.5e-8).
 *
 * Hand-rolled because pulling a stats package in for one function would be a
 * dependency to audit, update and explain for the rest of the project's life.
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  if (z < 0) return 1 - normalCdf(-z);

  const t = 1 / (1 + 0.2316419 * z);
  const poly =
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - INV_SQRT_2PI * Math.exp((-z * z) / 2) * poly;
}

/* -------------------------------------------------------------------------
   Outlook: what a lineup has already scored and what is still coming
   ------------------------------------------------------------------------- */

/** One starter, as gameday knows them mid-Sunday. */
export interface StarterLive {
  playerId: string;
  position: string;
  /**
   * The NFL game this player is in, or null on a bye or when their team could
   * not be matched to a game. Null means nothing more is coming from them.
   */
  eventId: string | null;
  gameState: GameState | null;
  /** Points so far. Always the platform's own number, never computed here. */
  points: number;
  /** Week projection, or null when the platform has none. */
  projection: number | null;
}

/** A team's live position, and what it still expects. */
export interface TeamOutlook {
  /** The platform's own live team total. */
  score: number;
  /** Projected points still to come from this lineup. */
  remaining: number;
  /** Variance of `remaining`, for the win-probability model. */
  variance: number;
  yetToPlay: number;
  inProgress: number;
  done: number;
  /** Remaining points keyed by NFL game — what rooting interest is built from. */
  remainingByGame: Map<string, number>;
}

/**
 * Rolls a lineup up into an outlook.
 *
 * `score` is passed in rather than summed from the starters: the platform's
 * team total is authoritative and can legitimately differ from the sum of its
 * parts (bonuses, corrections, a slot we mapped differently). Summing our own
 * would eventually disagree with the Sleeper app by a tenth of a point, which
 * is the fastest way to make the whole page untrustworthy.
 *
 * The in-progress rule is `max(0, projection - scored so far)`: a player who
 * has already beaten his projection has nothing left to give the model, and one
 * who has not is assumed to make up the difference. This is crude — it ignores
 * the game clock entirely — but it is self-correcting as the game runs, and it
 * never predicts a player will lose points.
 */
export function buildOutlook(score: number, starters: StarterLive[]): TeamOutlook {
  const remainingByGame = new Map<string, number>();
  let remaining = 0;
  let variance = 0;
  let yetToPlay = 0;
  let inProgress = 0;
  let done = 0;

  for (const s of starters) {
    const projection = s.projection ?? fallbackProjection(s.position);
    const sigma = positionSigma(s.position);

    // No game means a bye or an unmapped team: nothing is coming, and counting
    // it as "yet to play" would promise points that cannot arrive.
    if (!s.eventId || !s.gameState || s.gameState === "post") {
      done++;
      continue;
    }

    let left: number;
    if (s.gameState === "pre") {
      left = Math.max(0, projection);
      variance += sigma * sigma;
      yetToPlay++;
    } else {
      left = Math.max(0, projection - s.points);
      // Scale the variance down as the game burns off, so a player who is
      // nearly finished stops widening the distribution.
      const fraction = projection > 0 ? Math.min(1, left / projection) : 0;
      variance += sigma * sigma * fraction;
      inProgress++;
    }

    remaining += left;
    remainingByGame.set(s.eventId, (remainingByGame.get(s.eventId) ?? 0) + left);
  }

  return { score, remaining, variance, yetToPlay, inProgress, done, remainingByGame };
}

/* -------------------------------------------------------------------------
   Win probability, survival, leverage
   ------------------------------------------------------------------------- */

/** The projected final, ignoring uncertainty. */
function projectedFinal(t: TeamOutlook): number {
  return t.score + t.remaining;
}

/**
 * P(mine finishes above theirs).
 *
 * Both sides' remaining points are treated as normal and independent, so the
 * difference is normal with the variances added. With no games left the
 * variance is zero and this collapses to a straight comparison — which is
 * correct: a finished week has no probability left in it.
 */
export function winProbability(mine: TeamOutlook, theirs: TeamOutlook): number {
  const mean = projectedFinal(mine) - projectedFinal(theirs);
  const sd = Math.sqrt(mine.variance + theirs.variance);

  if (sd <= 0) return mean > 0 ? 1 : mean < 0 ? 0 : 0.5;
  return normalCdf(mean / sd);
}

/**
 * P(not finishing last) — the win condition in a survival league.
 *
 * Guillotine eliminates the week's lowest scorer, so there is no opponent to
 * model against; the whole field is the opponent. Survival is the chance that
 * at least one team finishes below you, which is one minus the chance that
 * every one of them finishes above.
 *
 * Assumes the teams are independent of each other, which is the same
 * simplification the head-to-head path makes and wrong in the same direction.
 */
export function survivalProbability(
  mine: TeamOutlook,
  field: TeamOutlook[],
): number {
  if (field.length === 0) return 1;

  let allAbove = 1;
  for (const rival of field) {
    allAbove *= 1 - winProbability(mine, rival);
  }
  return 1 - allAbove;
}

/**
 * How much one more fantasy point is worth, as a change in the outcome
 * probability.
 *
 * Computed as a central difference over `LEVERAGE_STEP` rather than
 * analytically, for one reason worth the rounding error: the same helper then
 * works for head-to-head win probability and for survival, and for the user's
 * points and for a rival's. One code path, four uses, and the property that
 * actually matters — near zero when the outcome is decided, largest when it is
 * close — is a property of the curve rather than of any one formula.
 */
function marginal(probability: (shift: number) => number): number {
  const half = LEVERAGE_STEP / 2;
  return (probability(half) - probability(-half)) / LEVERAGE_STEP;
}

/** Shifts a team's score without disturbing anything else about it. */
function shifted(t: TeamOutlook, by: number): TeamOutlook {
  return { ...t, score: t.score + by };
}

/** Leverage of the user's own points in a head-to-head league. */
export function headToHeadLeverage(mine: TeamOutlook, theirs: TeamOutlook): number {
  return marginal((shift) => winProbability(shifted(mine, shift), theirs));
}

/** Leverage of the user's own points in a survival league. */
export function survivalLeverage(mine: TeamOutlook, field: TeamOutlook[]): number {
  return marginal((shift) => survivalProbability(shifted(mine, shift), field));
}

/* -------------------------------------------------------------------------
   Rooting interest
   ------------------------------------------------------------------------- */

/**
 * One league, reduced to what rooting interest needs: the user's remaining
 * points per game, and every rival whose points hurt — each with its own
 * weight.
 *
 * A head-to-head league has exactly one rival. A survival league has all of
 * them, and their weights fall out naturally: a team far above the user barely
 * changes their survival, so its leverage is ~0 and it drops out without
 * needing a special case.
 */
export interface LeagueRooting {
  leagueId: string;
  leagueName: string;
  platform: Platform;
  /** Weight applied to the user's own remaining points. */
  myWeight: number;
  myRemainingByGame: Map<string, number>;
  rivals: Array<{
    /** Weight applied to this rival's remaining points. Positive = hurts you. */
    weight: number;
    remainingByGame: Map<string, number>;
  }>;
  /** Starter counts per game, for the UI's "3 of yours, 1 of theirs". */
  myStartersByGame: Map<string, number>;
  opponentStartersByGame: Map<string, number>;
}

/** Below this, a net swing is noise rather than a reason to look up. */
const NEUTRAL_EPSILON = 1e-9;

/**
 * Net rooting interest per NFL game, summed across every league.
 *
 * `mode` only changes the weights, which is why there is one code path rather
 * than two: in `leverage` mode each league is weighted by how much a point
 * moves its outcome, and in `raw` mode every weight is 1, so the result is
 * literally the projected point differential. The raw mode is the escape hatch
 * — if the model's ordering ever looks wrong, the unmodelled truth is one
 * toggle away and computed by the same code.
 */
export function rootingInterest(
  leagues: LeagueRooting[],
  games: Array<{ eventId: string; home: string; away: string }>,
  mode: RootingMode,
): RootingInterest[] {
  const out: RootingInterest[] = [];

  for (const game of games) {
    const contributions: RootingContribution[] = [];
    let net = 0;

    for (const league of leagues) {
      const myWeight = mode === "raw" ? 1 : league.myWeight;
      const mine = league.myRemainingByGame.get(game.eventId) ?? 0;

      let leagueNet = myWeight * mine;
      for (const rival of league.rivals) {
        const weight = mode === "raw" ? 1 : rival.weight;
        leagueNet -= weight * (rival.remainingByGame.get(game.eventId) ?? 0);
      }

      const mineInGame = league.myStartersByGame.get(game.eventId) ?? 0;
      const opponentInGame = league.opponentStartersByGame.get(game.eventId) ?? 0;

      // A league with nobody in this game contributes nothing and would only
      // clutter the breakdown.
      if (mineInGame === 0 && opponentInGame === 0) continue;

      contributions.push({
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        platform: league.platform,
        net: leagueNet,
        mineInGame,
        opponentInGame,
      });
      net += leagueNet;
    }

    contributions.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

    // Conflicted means this one game genuinely pulls both ways across leagues —
    // the thing no single-league app can tell you, so it is worth its own flag
    // rather than being inferred from a signed total that hides it.
    const helps = contributions.some((c) => c.net > NEUTRAL_EPSILON);
    const hurts = contributions.some((c) => c.net < -NEUTRAL_EPSILON);

    const direction =
      net > NEUTRAL_EPSILON ? "for" : net < -NEUTRAL_EPSILON ? "against" : "neutral";

    out.push({
      eventId: game.eventId,
      net,
      // Filled in below, once the whole slate is known.
      strength: 0,
      direction,
      rootFor: direction === "neutral" ? null : direction === "for" ? game.home : game.away,
      conflicted: helps && hurts,
      contributions,
    });
  }

  /*
   * Strength is relative to the strongest interest on the slate, because the
   * reader's question is "where do I look first" — a comparison — and the
   * absolute units (win-probability points, or fantasy points) mean nothing to
   * them. A slate with no interest anywhere leaves every strength at 0 rather
   * than dividing by zero to make one up.
   */
  const strongest = Math.max(...out.map((r) => Math.abs(r.net)), 0);
  if (strongest > 0) {
    for (const r of out) r.strength = Math.abs(r.net) / strongest;
  }

  out.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  return out;
}

/**
 * Which side of a game to root for.
 *
 * Exported separately because `rootingInterest` can only guess from the sign of
 * the total, and the sign alone cannot distinguish "root for the home team"
 * from "root for whoever my players are on". The caller knows which teams the
 * user's players play for; this resolves it properly.
 */
export function rootForTeam(
  interest: RootingInterest,
  game: { home: string; away: string },
  myTeams: ReadonlySet<string>,
): string | null {
  if (interest.direction === "neutral") return null;

  const mineHome = myTeams.has(game.home);
  const mineAway = myTeams.has(game.away);

  // Players on exactly one side: root for that side when the game helps, and
  // against it when it hurts.
  if (mineHome && !mineAway) return interest.direction === "for" ? game.home : game.away;
  if (mineAway && !mineHome) return interest.direction === "for" ? game.away : game.home;

  // Players on both sides, or neither: there is no side to name.
  return null;
}
