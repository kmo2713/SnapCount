/**
 * One matchup's win probability across the afternoon.
 *
 * The NFL drill-in already charts ESPN's win probability for a football game,
 * and the same shape is more interesting for a fantasy matchup: your week
 * turns on eight games at once, so the line moves for reasons no single
 * scoreboard shows.
 *
 * Built from the snapshots the sync job records every five minutes, and only
 * from what those rows actually contain. Two consequences worth stating
 * plainly:
 *
 *  - **The probability is read, not recomputed.** It is stored at capture time
 *    because it depends on every starter's projection and game state, none of
 *    which is kept. Recomputing from the stored scores would quietly ignore
 *    in-progress starters and draw a more confident line than the page showed.
 *  - **A swing is identified, not explained.** The samples say the probability
 *    moved and by how much, and which NFL games changed score in that window.
 *    They do not say which play did it — a fantasy swing comes from a stat
 *    line, and a snapshot five minutes wide holds no plays. So a swing is
 *    labelled with what is knowable and makes no causal claim.
 */

/** What one sample contributes, narrowed to the fields this module needs. */
export interface TimelineSample {
  at: Date;
  matchups?: Array<{
    leagueId: string;
    winProbability: number | null;
    survival: number | null;
    myScore: number;
    opponentScore: number | null;
  }>;
  games: Array<{
    eventId: string;
    shortName: string;
    state: string;
    awayScore: number | null;
    homeScore: number | null;
    lastPlay: string | null;
  }>;
}

/** One point on the line. */
export interface TimelinePoint {
  /** Epoch milliseconds — a chart axis wants a number, not a Date. */
  at: number;
  /** 0..100, so the axis reads as a percentage without a formatter. */
  winPct: number;
  myScore: number;
  opponentScore: number | null;
  /** Change in percentage points since the previous sample. */
  swing: number;
  /** Change in your score since the previous sample. */
  myGain: number;
  /** Change in your opponent's score since the previous sample. */
  opponentGain: number;
  /**
   * NFL games whose score moved in this window — context for a swing, never
   * a claim that one of them caused it.
   */
  movedGames: string[];
  /** The last play in each of those games, when the feed had one. */
  lastPlays: string[];
}

/**
 * How many percentage points a sample has to move to count as a swing.
 *
 * Five is roughly one touchdown's worth of probability in a close matchup and
 * comfortably above the drift a five-minute sample shows when nothing much
 * happens. Too low and every point is "key", which is the same as none being.
 */
export const SWING_THRESHOLD = 5;

/** True when this point deserves calling out. */
export function isSwing(point: TimelinePoint): boolean {
  return Math.abs(point.swing) >= SWING_THRESHOLD;
}

/**
 * The series for one league, oldest first.
 *
 * Samples that have no probability for this league are skipped rather than
 * plotted as zero: a league that had not started yet, or a row written before
 * the probability was recorded, is missing data and not a 0% chance of
 * winning. Survival leagues fall back to `survival`, which answers the same
 * question — "how likely am I to be fine this week" — for a format with no
 * opponent.
 */
export function matchupTimeline(
  samples: TimelineSample[],
  leagueId: string,
): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  let previous: {
    pct: number;
    myScore: number;
    opponentScore: number | null;
    games: Map<string, { total: number; lastPlay: string | null }>;
  } | null = null;

  for (const sample of samples) {
    const row = sample.matchups?.find((m) => m.leagueId === leagueId);
    if (!row) continue;

    const probability = row.winProbability ?? row.survival;
    if (probability == null) continue;

    const pct = probability * 100;

    const games = new Map<string, { total: number; lastPlay: string | null }>();
    for (const game of sample.games) {
      games.set(game.eventId, {
        total: (game.awayScore ?? 0) + (game.homeScore ?? 0),
        lastPlay: game.lastPlay,
      });
    }

    const movedGames: string[] = [];
    const lastPlays: string[] = [];
    if (previous) {
      for (const game of sample.games) {
        const before = previous.games.get(game.eventId);
        if (!before) continue;
        const now = (game.awayScore ?? 0) + (game.homeScore ?? 0);
        if (now !== before.total) {
          movedGames.push(game.shortName);
          if (game.lastPlay) lastPlays.push(game.lastPlay);
        }
      }
    }

    points.push({
      at: sample.at.getTime(),
      winPct: pct,
      myScore: row.myScore,
      opponentScore: row.opponentScore,
      swing: previous ? pct - previous.pct : 0,
      myGain: previous ? row.myScore - previous.myScore : 0,
      opponentGain:
        previous && previous.opponentScore != null && row.opponentScore != null
          ? row.opponentScore - previous.opponentScore
          : 0,
      movedGames,
      lastPlays,
    });

    previous = {
      pct,
      myScore: row.myScore,
      opponentScore: row.opponentScore,
      games,
    };
  }

  return points;
}

/**
 * The time window each swing should be blamed on.
 *
 * A swing is a change *since the previous sample*, so the window runs from
 * that sample to this one. Blaming the instant it was noticed would look for
 * causes after the fact, and every attribution would name the plays that
 * happened next rather than the ones responsible.
 *
 * The first point has no predecessor and is skipped — its "swing" is zero by
 * construction, but a caller that ranked by magnitude and got a first point
 * through would otherwise search from the beginning of time.
 */
export function swingWindows(
  points: TimelinePoint[],
  swings: TimelinePoint[],
): Array<{ from: Date; to: Date }> {
  const indexByTime = new Map(points.map((p, i) => [p.at, i]));

  return swings.flatMap((swing) => {
    const index = indexByTime.get(swing.at);
    if (index == null || index === 0) return [];
    return [{ from: new Date(points[index - 1].at), to: new Date(swing.at) }];
  });
}

/**
 * The swings worth listing, biggest first.
 *
 * Ordered by size rather than by time because the question this answers is
 * "what decided my week", and the chart beside it already shows the order they
 * happened in.
 */
export function keySwings(points: TimelinePoint[], limit = 5): TimelinePoint[] {
  return points
    .filter(isSwing)
    .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing))
    .slice(0, limit);
}
