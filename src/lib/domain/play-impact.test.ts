/**
 * Tests for the per-play fantasy impact model.
 *
 * The bug this replaces: a play was annotated by whose roster the player was
 * on, plus for yours and minus for your opponent's. That reads as help and
 * harm, and it is backwards for every play that hurt the player involved —
 * Drake Maye's three interceptions showed as losses in the league where the
 * user was *facing* Maye. The last describe below is that exact case.
 */
import { describe, expect, it } from "vitest";

import {
  netForLeague,
  scoreStatLine,
  statsForPlay,
  statsForRole,
  type PlayStatLine,
} from "./play-impact";

/** Impact Fantasy Football 2026's real rates, read from the league. */
const IMPACT = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  fum_lost: -2,
};

describe("statsForRole", () => {
  it("credits a completion to both the passer and the receiver", () => {
    expect(statsForRole("Pass Reception", "passer", 12)).toEqual({ pass_yd: 12 });
    expect(statsForRole("Pass Reception", "receiver", 12)).toEqual({
      rec: 1,
      rec_yd: 12,
    });
  });

  it("adds the touchdown to both sides of a passing score", () => {
    expect(statsForRole("Passing Touchdown", "passer", 45)).toEqual({
      pass_yd: 45,
      pass_td: 1,
    });
    expect(statsForRole("Passing Touchdown", "receiver", 45)).toEqual({
      rec: 1,
      rec_yd: 45,
      rec_td: 1,
    });
  });

  it("charges an interception to the thrower and nobody else", () => {
    expect(statsForRole("Pass Interception Return", "passer", 30)).toEqual({
      pass_int: 1,
    });
    // The defender who caught it scores only in a league that pays for
    // defensive players, which is not modelled rather than guessed at.
    expect(statsForRole("Pass Interception Return", "passDefender", 30)).toEqual({});
  });

  it("gives a sack no value, because passing yards are already net of none", () => {
    // Measured against a real box score: summing completions alone gave the
    // official passing total while the quarterback was sacked three times.
    expect(statsForRole("Sack", "passer", -10)).toEqual({});
  });

  it("buckets a field goal by distance", () => {
    expect(statsForRole("Field Goal Good", "kicker", 50)).toEqual({
      fgm: 1,
      fgm_50p: 1,
    });
    expect(statsForRole("Field Goal Good", "kicker", 26)).toEqual({
      fgm: 1,
      fgm_20_29: 1,
    });
  });

  it("returns an empty line for a play known to be worth nothing", () => {
    expect(statsForRole("Pass Incompletion", "passer", 0)).toEqual({});
    expect(statsForRole("Penalty", "penalized", 5)).toEqual({});
  });

  it("returns null for a play type it does not recognise", () => {
    // Null and {} must stay distinct: one means "worth nothing", the other
    // means "we do not know", and only the second should hide the number.
    expect(statsForRole("Some New ESPN Play Type", "passer", 10)).toBeNull();
  });
});

describe("statsForPlay", () => {
  it("counts a touchdown receiver once, though ESPN lists them twice", () => {
    /*
     * The measured defect: on a Passing Touchdown the scorer appears as both
     * `receiver` and `scorer`. Counting both gave Jaxon Smith-Njigba 167
     * receiving yards against an official 122 — his 45-yard score twice.
     */
    const stats = statsForPlay({
      typeText: "Passing Touchdown",
      yards: 45,
      participants: [
        { espnId: "qb", role: "passer" },
        { espnId: "wr", role: "receiver" },
        { espnId: "wr", role: "scorer" },
      ],
    });

    expect(stats?.get("wr")).toEqual({ rec: 1, rec_yd: 45, rec_td: 1 });
    expect(stats?.get("qb")).toEqual({ pass_yd: 45, pass_td: 1 });
    expect(stats?.size).toBe(2);
  });

  it("prefers the doing role however ESPN orders the participants", () => {
    const asGiven = statsForPlay({
      typeText: "Passing Touchdown",
      yards: 7,
      participants: [
        { espnId: "wr", role: "scorer" },
        { espnId: "wr", role: "receiver" },
      ],
    });
    expect(asGiven?.get("wr")).toEqual({ rec: 1, rec_yd: 7, rec_td: 1 });
  });

  it("is null when any role on the play is unrecognised", () => {
    expect(
      statsForPlay({
        typeText: "Unknown Type",
        yards: 3,
        participants: [{ espnId: "a", role: "passer" }],
      }),
    ).toBeNull();
  });
});

describe("scoreStatLine", () => {
  it("multiplies each stat by the league's own rate", () => {
    // 12 receiving yards at 0.1 plus a reception at 1.0.
    expect(scoreStatLine({ rec: 1, rec_yd: 12 }, IMPACT)).toBeCloseTo(2.2, 5);
  });

  it("ignores stats the league does not pay for", () => {
    expect(scoreStatLine({ pass_yd: 100, tackles: 9 }, IMPACT)).toBeCloseTo(4, 5);
  });

  it("is null without scoring rules, so the caller can omit the number", () => {
    expect(scoreStatLine({ rec: 1 }, null)).toBeNull();
  });
});

describe("netForLeague — the interception that was reported backwards", () => {
  /** Maye throws a pick. Only he is charged. */
  const interception = new Map<string, PlayStatLine>([["maye", { pass_int: 1 }]]);

  it("is a gain in the league where you face the quarterback", () => {
    // The reported bug: this showed as "− Impact Fantasy Football 2026".
    const net = netForLeague(
      interception,
      new Map([["maye", "against"]]),
      IMPACT,
    );
    expect(net).toBe(2);
  });

  it("is a loss in the league where you start him", () => {
    const net = netForLeague(interception, new Map([["maye", "mine"]]), IMPACT);
    expect(net).toBe(-2);
  });

  it("nets both sides of a play that touches you twice", () => {
    // Your quarterback throwing to a receiver your opponent starts: you take
    // the passing yards and pay for the reception.
    const stats = new Map<string, PlayStatLine>([
      ["qb", { pass_yd: 20 }],
      ["wr", { rec: 1, rec_yd: 20 }],
    ]);
    const net = netForLeague(
      stats,
      new Map([
        ["qb", "mine"],
        ["wr", "against"],
      ]),
      IMPACT,
    );
    // +0.8 passing against -(1 + 2.0) receiving.
    expect(net).toBeCloseTo(0.8 - 3, 5);
  });

  it("ignores players you have no stake in", () => {
    const stats = new Map<string, PlayStatLine>([
      ["maye", { pass_int: 1 }],
      ["stranger", { rec: 1, rec_yd: 40 }],
    ]);
    expect(netForLeague(stats, new Map([["maye", "against"]]), IMPACT)).toBe(2);
  });

  it("reports a genuine zero as zero rather than as minus zero", () => {
    const net = netForLeague(
      new Map([["qb", { pass_yd: 0 }]]),
      new Map([["qb", "against"]]),
      IMPACT,
    );
    expect(net).toBe(0);
    expect(Object.is(net, -0)).toBe(false);
  });

  it("is null when the league's scoring could not be read", () => {
    expect(netForLeague(interception, new Map([["maye", "against"]]), null)).toBeNull();
  });
});
