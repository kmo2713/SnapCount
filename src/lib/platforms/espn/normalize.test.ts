/**
 * Tests for the ESPN matchup normalizer.
 *
 * Written after a live-week failure that every other check passed. ESPN
 * reports a team's score in one field once a scoring period closes and in a
 * different one while it is being played; we read only the first, so through
 * an entire live week both ESPN leagues reported no score at all while the
 * seven Sleeper ones ticked normally. Nothing caught it — typecheck, lint, 69
 * tests and a sync that logged `success` on every run, because "no points yet"
 * is indistinguishable from "no points" unless something asserts the
 * difference. This is that something.
 */
import { describe, expect, it } from "vitest";

import type { EspnLeagueResponse } from "./league-types";
import { pairingsFor } from "./normalize";

/** A matchup with whichever score fields the case is about. */
function league(
  home: Record<string, unknown>,
  away: Record<string, unknown> = {},
): EspnLeagueResponse {
  return {
    schedule: [
      {
        id: 7,
        matchupPeriodId: 1,
        home: { teamId: 1, ...home },
        away: { teamId: 2, ...away },
      },
    ],
  } as EspnLeagueResponse;
}

describe("pairingsFor — team score", () => {
  it("prefers the closed-period score, so history is unchanged", () => {
    // Both fields present and disagreeing: the closed record must win, or
    // every completed week silently rewrites itself on the next sync.
    const pairings = pairingsFor(
      league({
        pointsByScoringPeriod: { "1": 116.62 },
        rosterForCurrentScoringPeriod: { appliedStatTotal: 9.82, entries: [] },
      }),
      1,
    );
    expect(pairings[0].points).toBe(116.62);
  });

  it("falls back to the live applied total mid-week", () => {
    // The exact shape of the bug: closed-period field absent, players scoring.
    const pairings = pairingsFor(
      league({
        totalPoints: 0,
        gamesPlayed: 0,
        rosterForCurrentScoringPeriod: { appliedStatTotal: 26.2, entries: [] },
      }),
      1,
    );
    expect(pairings[0].points).toBe(26.2);
  });

  it("reports a real zero as zero, not as missing", () => {
    // A team whose players have not kicked off yet genuinely has none. Showing
    // an em dash beside an opponent on 26.2 reads as broken, not as pending.
    const pairings = pairingsFor(
      league({ rosterForCurrentScoringPeriod: { appliedStatTotal: 0, entries: [] } }),
      1,
    );
    expect(pairings[0].points).toBe(0);
  });

  it("reports null only when ESPN offers no score at all", () => {
    const pairings = pairingsFor(league({ rosterForCurrentScoringPeriod: { entries: [] } }), 1);
    expect(pairings[0].points).toBeNull();
  });

  it("never trusts gamesPlayed, which reads 0 on a finished week", () => {
    const pairings = pairingsFor(
      league({ gamesPlayed: 0, pointsByScoringPeriod: { "1": 98.4 } }),
      1,
    );
    expect(pairings[0].points).toBe(98.4);
  });

  it("scores both sides and pairs them to each other", () => {
    const pairings = pairingsFor(
      league(
        { rosterForCurrentScoringPeriod: { appliedStatTotal: 28.5, entries: [] } },
        { rosterForCurrentScoringPeriod: { appliedStatTotal: 7.8, entries: [] } },
      ),
      1,
    );

    expect(pairings).toHaveLength(2);
    const home = pairings.find((p) => p.teamId === 1);
    const away = pairings.find((p) => p.teamId === 2);
    expect(home?.points).toBe(28.5);
    expect(home?.opponentTeamId).toBe(2);
    expect(away?.points).toBe(7.8);
    expect(away?.opponentTeamId).toBe(1);
  });

  it("ignores matchups from other periods", () => {
    expect(pairingsFor(league({ pointsByScoringPeriod: { "1": 50 } }), 2)).toEqual([]);
  });
});
