/**
 * Tests for the fantasy matchup timeline.
 *
 * Written against synthetic samples rather than the database, because the
 * table this reads has one row in it: the cron that writes snapshots has never
 * run, so there is no real afternoon to test against yet. The logic is pure
 * and the shapes are known, so it can be tested properly anyway — and this is
 * the only way it will be correct on the first Sunday it has data.
 */
import { describe, expect, it } from "vitest";

import {
  keySwings,
  matchupTimeline,
  SWING_THRESHOLD,
  type TimelineSample,
} from "./matchup-timeline";

function sample(
  minute: number,
  matchups: TimelineSample["matchups"],
  games: TimelineSample["games"] = [],
): TimelineSample {
  return { at: new Date(Date.UTC(2026, 8, 13, 17, minute)), matchups, games };
}

const L = "league-1";

describe("matchupTimeline", () => {
  it("turns probabilities into a percentage series, oldest first", () => {
    const points = matchupTimeline(
      [
        sample(0, [{ leagueId: L, winProbability: 0.35, survival: null, myScore: 10, opponentScore: 20 }]),
        sample(5, [{ leagueId: L, winProbability: 0.5, survival: null, myScore: 30, opponentScore: 25 }]),
      ],
      L,
    );

    expect(points.map((p) => p.winPct)).toEqual([35, 50]);
    expect(points[0].swing).toBe(0);
    expect(points[1].swing).toBeCloseTo(15, 5);
    expect(points[1].myGain).toBe(20);
    expect(points[1].opponentGain).toBe(5);
  });

  it("ignores other leagues' rows", () => {
    const points = matchupTimeline(
      [
        sample(0, [
          { leagueId: "other", winProbability: 0.9, survival: null, myScore: 1, opponentScore: 2 },
          { leagueId: L, winProbability: 0.4, survival: null, myScore: 3, opponentScore: 4 },
        ]),
      ],
      L,
    );
    expect(points).toHaveLength(1);
    expect(points[0].winPct).toBe(40);
  });

  it("skips a sample with no probability instead of plotting zero", () => {
    // A league that had not kicked off, or a row written before the field
    // existed. Zero would say "certain to lose", which is a different claim.
    const points = matchupTimeline(
      [
        sample(0, [{ leagueId: L, winProbability: null, survival: null, myScore: 0, opponentScore: 0 }]),
        sample(5, undefined),
        sample(10, [{ leagueId: L, winProbability: 0.6, survival: null, myScore: 40, opponentScore: 30 }]),
      ],
      L,
    );
    expect(points).toHaveLength(1);
    expect(points[0].winPct).toBe(60);
    // The surviving point is the first one plotted, so it has no swing.
    expect(points[0].swing).toBe(0);
  });

  it("uses survival for a league with no opponent", () => {
    const points = matchupTimeline(
      [sample(0, [{ leagueId: L, winProbability: null, survival: 0.82, myScore: 55, opponentScore: null }])],
      L,
    );
    expect(points[0].winPct).toBeCloseTo(82, 5);
    expect(points[0].opponentScore).toBeNull();
    expect(points[0].opponentGain).toBe(0);
  });

  it("names the NFL games whose score moved between samples", () => {
    const games = (awayScore: number, lastPlay: string) => [
      { eventId: "g1", shortName: "NE @ SEA", state: "in", awayScore, homeScore: 7, lastPlay },
      { eventId: "g2", shortName: "TB @ CIN", state: "in", awayScore: 3, homeScore: 3, lastPlay: "punt" },
    ];

    const points = matchupTimeline(
      [
        sample(0, [{ leagueId: L, winProbability: 0.4, survival: null, myScore: 10, opponentScore: 10 }], games(0, "kickoff")),
        sample(5, [{ leagueId: L, winProbability: 0.6, survival: null, myScore: 25, opponentScore: 10 }], games(7, "12 yd TD pass")),
      ],
      L,
    );

    // Only the game that actually changed, and no claim that it caused it.
    expect(points[1].movedGames).toEqual(["NE @ SEA"]);
    expect(points[1].lastPlays).toEqual(["12 yd TD pass"]);
    expect(points[0].movedGames).toEqual([]);
  });
});

describe("keySwings", () => {
  const series = (...pcts: number[]) =>
    matchupTimeline(
      pcts.map((p, i) =>
        sample(i * 5, [
          { leagueId: L, winProbability: p / 100, survival: null, myScore: i * 10, opponentScore: i * 8 },
        ]),
      ),
      L,
    );

  it("returns only the moves past the threshold, biggest first", () => {
    // Steps of +2, +20, -8: only the last two clear five points.
    const swings = keySwings(series(40, 42, 62, 54));
    expect(swings.map((s) => Math.round(s.swing))).toEqual([20, -8]);
  });

  it("keeps a big drop, not just a big gain", () => {
    const swings = keySwings(series(80, 30));
    expect(swings).toHaveLength(1);
    expect(swings[0].swing).toBeCloseTo(-50, 5);
  });

  it("is empty on a quiet afternoon", () => {
    expect(keySwings(series(50, 51, 52, 53))).toEqual([]);
  });

  it("ignores the first point, which has no previous sample to move from", () => {
    // A 70% opening reading is not a 70-point swing.
    expect(keySwings(series(70))).toEqual([]);
  });

  it("respects the limit", () => {
    expect(keySwings(series(0, 20, 0, 20, 0, 20, 0), 2)).toHaveLength(2);
  });

  it("treats exactly the threshold as a swing", () => {
    const swings = keySwings(series(50, 50 + SWING_THRESHOLD));
    expect(swings).toHaveLength(1);
  });
});
