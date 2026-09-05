/**
 * Tests for the rooting model.
 *
 * These exist because the model fails silently. A wrong win probability does
 * not throw or render blank — it states a confident number that happens to be
 * false, and orders the whole slate by it. Every case below names the defect it
 * would catch, and the properties matter more than the point values: leverage
 * peaking at a tie and vanishing in a blowout is the entire reason the hero
 * feature is worth building, so it is asserted directly rather than assumed.
 */
import { describe, expect, it } from "vitest";

import type { RootingInterest } from "./gameday";

import {
  buildOutlook,
  fallbackProjection,
  headToHeadLeverage,
  normalCdf,
  positionSigma,
  rootForTeam,
  rootingInterest,
  survivalProbability,
  winProbability,
  type LeagueRooting,
  type StarterLive,
  type TeamOutlook,
} from "./rooting";

/** A starter yet to kick off, with an explicit projection. */
function pending(position: string, projection: number | null, eventId = "G1"): StarterLive {
  return { playerId: `${position}-${projection}-${eventId}`, position, eventId, gameState: "pre", points: 0, projection };
}

/** A starter whose game is over, having scored `points`. */
function finished(position: string, points: number, eventId = "G1"): StarterLive {
  return { playerId: `${position}-done`, position, eventId, gameState: "post", points, projection: points };
}

/** An outlook with no lineup behind it — a week already decided. */
function settled(score: number): TeamOutlook {
  return {
    score,
    remaining: 0,
    variance: 0,
    yetToPlay: 0,
    inProgress: 0,
    done: 0,
    remainingByGame: new Map(),
  };
}

describe("normalCdf", () => {
  it("is 0.5 at the mean and symmetric about it", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1) + normalCdf(-1)).toBeCloseTo(1, 6);
  });

  it("matches known quantiles", () => {
    // Catches a transcription error in the A&S coefficients, which would
    // otherwise produce a plausible-looking but wrong curve.
    expect(normalCdf(1.281551)).toBeCloseTo(0.9, 5);
    expect(normalCdf(1.644854)).toBeCloseTo(0.95, 5);
    expect(normalCdf(2.326348)).toBeCloseTo(0.99, 5);
  });
});

describe("buildOutlook", () => {
  it("uses the position fallback for a starter with no projection, never zero", () => {
    // The defect: contributing 0 for the ~4% of starters Sleeper does not
    // project, which silently claims a starter will be shut out.
    const out = buildOutlook(0, [pending("WR", null)]);
    expect(out.remaining).toBe(fallbackProjection("WR"));
    expect(out.remaining).toBeGreaterThan(0);
  });

  it("treats a player with no game as done, not as yet to play", () => {
    // The defect: a bye-week starter counted as pending, promising points that
    // can never arrive and inflating every downstream number.
    const bye: StarterLive = {
      playerId: "bye",
      position: "RB",
      eventId: null,
      gameState: null,
      points: 0,
      projection: 12,
    };
    const out = buildOutlook(0, [bye]);
    expect(out.remaining).toBe(0);
    expect(out.yetToPlay).toBe(0);
    expect(out.done).toBe(1);
  });

  it("counts nothing remaining for a finished game", () => {
    const out = buildOutlook(20, [finished("RB", 20)]);
    expect(out.remaining).toBe(0);
    expect(out.variance).toBe(0);
    expect(out.done).toBe(1);
  });

  it("never predicts a player will lose points", () => {
    // In-progress starter who has already beaten his projection.
    const over: StarterLive = {
      playerId: "over",
      position: "WR",
      eventId: "G1",
      gameState: "in",
      points: 25,
      projection: 10,
    };
    expect(buildOutlook(25, [over]).remaining).toBe(0);
  });

  it("keeps the platform's team total rather than summing the parts", () => {
    // The defect this guards: computing our own total, which will eventually
    // disagree with the Sleeper app by a tenth of a point.
    const out = buildOutlook(101.4, [finished("RB", 20), finished("WR", 10)]);
    expect(out.score).toBe(101.4);
  });

  it("attributes remaining points to the right game", () => {
    const out = buildOutlook(0, [pending("WR", 10, "G1"), pending("RB", 8, "G2"), pending("TE", 5, "G1")]);
    expect(out.remainingByGame.get("G1")).toBe(15);
    expect(out.remainingByGame.get("G2")).toBe(8);
  });
});

describe("winProbability", () => {
  it("is 0.5 for two identical outlooks", () => {
    const a = buildOutlook(50, [pending("WR", 10)]);
    const b = buildOutlook(50, [pending("WR", 10)]);
    expect(winProbability(a, b)).toBeCloseTo(0.5, 6);
  });

  it("is near certain when the lead exceeds everything the opponent has left", () => {
    const mine = settled(100);
    const theirs = buildOutlook(50, [pending("WR", 20)]);
    expect(winProbability(mine, theirs)).toBeGreaterThan(0.99);
  });

  it("is near hopeless in the mirrored case", () => {
    const mine = buildOutlook(50, [pending("WR", 20)]);
    const theirs = settled(100);
    expect(winProbability(mine, theirs)).toBeLessThan(0.01);
  });

  it("collapses to a straight comparison once nothing is left", () => {
    // A finished week has no probability left in it.
    expect(winProbability(settled(100), settled(90))).toBe(1);
    expect(winProbability(settled(90), settled(100))).toBe(0);
    expect(winProbability(settled(100), settled(100))).toBe(0.5);
  });

  it("never decreases as my remaining projection grows", () => {
    // Monotonicity is the property a sign error would break while leaving
    // every individual value looking reasonable.
    const theirs = buildOutlook(60, [pending("RB", 12)]);
    let previous = -1;
    for (let projection = 0; projection <= 30; projection += 2) {
      const mine = buildOutlook(60, [pending("WR", projection)]);
      const p = winProbability(mine, theirs);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });

  it("matches the hand-worked scenario", () => {
    /*
     * Worked by hand so this test documents the model rather than merely
     * re-running it:
     *   mine  = 80 scored + one WR projected 10  -> final 90, sigma 8, var 64
     *   opp   = 85 scored + one RB projected  9  -> final 94, sigma 7, var 49
     *   mean  = 90 - 94 = -4
     *   sd    = sqrt(64 + 49) = sqrt(113) = 10.630146
     *   z     = -4 / 10.630146 = -0.376288
     *   P     = Phi(-0.376288) = 0.353351
     */
    const mine = buildOutlook(80, [pending("WR", 10)]);
    const theirs = buildOutlook(85, [pending("RB", 9)]);

    expect(mine.remaining).toBe(10);
    expect(mine.variance).toBe(64);
    expect(theirs.variance).toBe(49);
    expect(winProbability(mine, theirs)).toBeCloseTo(0.353351, 5);
  });
});

describe("leverage", () => {
  it("peaks at a tie and vanishes in a blowout", () => {
    // This is the property the whole feature rests on: a decided league must
    // stop influencing which game the reader looks at.
    const lineup = [pending("WR", 10)];
    const tied = headToHeadLeverage(buildOutlook(50, lineup), buildOutlook(50, lineup));
    const blown = headToHeadLeverage(buildOutlook(110, lineup), buildOutlook(50, lineup));

    expect(tied).toBeGreaterThan(blown);
    expect(blown).toBeLessThan(1e-6);
  });

  it("agrees with the analytic derivative at a tie", () => {
    /*
     * At a tie the derivative of Phi(m/s) is phi(0)/s. With two WRs
     * (sigma 8 each), s = sqrt(128) = 11.313708 and phi(0)/s = 0.035262.
     * The central difference over one point gives 0.035251 — the ~1e-5 gap is
     * the discretisation, and anything larger means the difference is being
     * taken wrongly.
     */
    const lineup = [pending("WR", 10)];
    const actual = headToHeadLeverage(buildOutlook(50, lineup), buildOutlook(50, lineup));
    expect(actual).toBeCloseTo(0.035262, 3);
  });

  it("is zero when no games remain", () => {
    expect(headToHeadLeverage(settled(90), settled(88))).toBe(0);
  });
});

describe("survivalProbability", () => {
  it("is zero for the lowest score once nothing is left", () => {
    const mine = settled(70);
    const field = [settled(90), settled(85), settled(80)];
    expect(survivalProbability(mine, field)).toBe(0);
  });

  it("is one when someone is already below and nothing is left", () => {
    const mine = settled(80);
    const field = [settled(90), settled(70)];
    expect(survivalProbability(mine, field)).toBe(1);
  });

  it("rises as my own remaining projection grows", () => {
    /*
     * Note this is the opposite of what the plan's test-plan text said ("rises
     * as the field's remaining projections rise"). That phrasing was wrong: a
     * rival scoring more points cannot improve the user's survival. What lifts
     * survival is the user's own lineup, so that is what is asserted.
     */
    const field = [settled(95), settled(92), settled(88)];
    let previous = -1;
    for (let projection = 0; projection <= 40; projection += 5) {
      const mine = buildOutlook(70, [pending("WR", projection)]);
      const p = survivalProbability(mine, field);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it("survives trivially against an empty field", () => {
    // Guards a divide-by-nothing or an all-products-of-nothing bug in a league
    // of one, which is what a Guillotine league eventually becomes.
    expect(survivalProbability(settled(50), [])).toBe(1);
  });
});

describe("rootingInterest", () => {
  const games = [{ eventId: "G1", home: "GB", away: "WAS" }];

  /** A head-to-head league: one rival, both weighted the same. */
  function league(
    id: string,
    mine: number,
    theirs: number,
    weight = 0.03,
  ): LeagueRooting {
    return {
      leagueId: id,
      leagueName: id,
      platform: "sleeper",
      myWeight: weight,
      myRemainingByGame: new Map(mine ? [["G1", mine]] : []),
      rivals: [{ weight, remainingByGame: new Map(theirs ? [["G1", theirs]] : []) }],
      myStartersByGame: new Map(mine ? [["G1", 1]] : []),
      opponentStartersByGame: new Map(theirs ? [["G1", 1]] : []),
    };
  }

  it("is neutral for a game containing nobody", () => {
    const [interest] = rootingInterest([league("A", 0, 0)], games, "leverage");
    expect(interest.net).toBe(0);
    expect(interest.direction).toBe("neutral");
    expect(interest.contributions).toHaveLength(0);
  });

  it("flags a game that helps in one league and hurts in another", () => {
    // The case no single-league app can show, and the reason `conflicted`
    // exists as its own flag rather than being inferred from the total: here
    // the two cancel exactly, so the signed net hides the conflict entirely.
    const helps = league("Shlong", 10, 0);
    const hurts = league("EFL", 0, 10);
    const [interest] = rootingInterest([helps, hurts], games, "raw");

    expect(interest.net).toBeCloseTo(0, 9);
    expect(interest.direction).toBe("neutral");
    expect(interest.conflicted).toBe(true);
  });

  it("raw mode is the plain point differential, ignoring the weights", () => {
    // Weight set absurdly so a leaked weight would be obvious.
    const [interest] = rootingInterest([league("A", 14, 6, 99)], games, "raw");
    expect(interest.net).toBe(8);
  });

  it("leverage mode weights the swing by the league's leverage", () => {
    const [interest] = rootingInterest([league("A", 14, 6, 0.05)], games, "leverage");
    expect(interest.net).toBeCloseTo(0.05 * 14 - 0.05 * 6, 9);
  });

  it("a decided league drops out of leverage mode but not raw mode", () => {
    // Two leagues with identical point swings; one is already decided, so its
    // leverage is ~0. Leverage mode must follow the live one only.
    const live = league("live", 10, 0, 0.04);
    const decided = league("decided", 0, 10, 1e-9);

    const [byLeverage] = rootingInterest([live, decided], games, "leverage");
    expect(byLeverage.direction).toBe("for");

    const [byRaw] = rootingInterest([live, decided], games, "raw");
    expect(byRaw.direction).toBe("neutral");
  });

  it("sorts the slate by absolute interest and scales strength against the strongest", () => {
    const slate = [
      { eventId: "big", home: "GB", away: "WAS" },
      { eventId: "small", home: "KC", away: "NO" },
    ];
    const leagues: LeagueRooting[] = [
      {
        leagueId: "A",
        leagueName: "A",
        platform: "sleeper",
        myWeight: 1,
        myRemainingByGame: new Map([
          ["big", 20],
          ["small", 5],
        ]),
        rivals: [],
        myStartersByGame: new Map([
          ["big", 2],
          ["small", 1],
        ]),
        opponentStartersByGame: new Map(),
      },
    ];

    const result = rootingInterest(leagues, slate, "raw");
    expect(result.map((r) => r.eventId)).toEqual(["big", "small"]);
    expect(result[0].strength).toBe(1);
    expect(result[1].strength).toBeCloseTo(0.25, 9);
  });

  it("leaves every strength at zero on a slate with no interest", () => {
    // Guards a divide-by-zero that would surface as NaN in the UI.
    const result = rootingInterest([league("A", 0, 0)], games, "raw");
    expect(result[0].strength).toBe(0);
    expect(Number.isNaN(result[0].strength)).toBe(false);
  });
});

describe("rootForTeam", () => {
  const game = { home: "GB", away: "WAS" };

  it("names the side my players are on when the game helps", () => {
    const interest = { direction: "for" as const };
    expect(rootForTeam(asInterest(interest), game, new Set(["GB"]))).toBe("GB");
    expect(rootForTeam(asInterest(interest), game, new Set(["WAS"]))).toBe("WAS");
  });

  it("names the opposite side when the game hurts", () => {
    const interest = asInterest({ direction: "against" as const });
    expect(rootForTeam(interest, game, new Set(["GB"]))).toBe("WAS");
  });

  it("names nobody when players sit on both sides or neither", () => {
    const interest = asInterest({ direction: "for" as const });
    expect(rootForTeam(interest, game, new Set(["GB", "WAS"]))).toBeNull();
    expect(rootForTeam(interest, game, new Set(["KC"]))).toBeNull();
  });

  it("names nobody when the interest is neutral", () => {
    const interest = asInterest({ direction: "neutral" as const });
    expect(rootForTeam(interest, game, new Set(["GB"]))).toBeNull();
  });
});

/* -- helper that keeps the cases above readable -- */

/** Only `direction` is read by `rootForTeam`; the rest is scaffolding. */
function asInterest(partial: Pick<RootingInterest, "direction">): RootingInterest {
  return {
    eventId: "G1",
    net: 0,
    strength: 0,
    rootFor: null,
    conflicted: false,
    contributions: [],
    ...partial,
  };
}

describe("positionSigma", () => {
  it("gives a kicker a narrower week than a receiver", () => {
    expect(positionSigma("K")).toBeLessThan(positionSigma("WR"));
  });

  it("is case-insensitive and falls back for unknown positions", () => {
    expect(positionSigma("qb")).toBe(positionSigma("QB"));
    expect(positionSigma("LB")).toBeGreaterThan(0);
  });
});
