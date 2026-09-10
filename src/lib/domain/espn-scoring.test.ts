/**
 * Tests for the ESPN scoring crosswalk.
 *
 * The case that makes this necessary rather than obvious: two of the four
 * configured leagues set every passing rule to `points: 0` and carry the real
 * rate only in `pointsOverrides`. Reading `points` alone scores passing yards,
 * passing touchdowns and interceptions at zero in those leagues — and reports
 * it as fact, which is the failure mode this whole area keeps producing.
 */
import { describe, expect, it } from "vitest";

import { effectiveRate, espnScoringSettings } from "./espn-scoring";

describe("effectiveRate", () => {
  it("uses the base points when the league sets them", () => {
    expect(effectiveRate({ statId: 3, points: 0.04 })).toBe(0.04);
  });

  it("falls back to the overrides when the base is zero", () => {
    // MONEY TIME's real shape for passing yards.
    expect(
      effectiveRate({
        statId: 3,
        points: 0,
        pointsOverrides: { "1": 0.04, "2": 0.04, "3": 0.04, "4": 0.04, "15": 0.04 },
      }),
    ).toBe(0.04);
  });

  it("keeps a negative base rate rather than treating it as unset", () => {
    expect(effectiveRate({ statId: 20, points: -2 })).toBe(-2);
  });

  it("refuses overrides that disagree, instead of averaging them", () => {
    // A rule that genuinely differs by position cannot be applied without
    // knowing the player's position, which this module does not have.
    expect(
      effectiveRate({ statId: 89, points: 0, pointsOverrides: { "16": 5, "1": 2 } }),
    ).toBeNull();
  });

  it("reports a real zero as zero when there is nothing to override it", () => {
    expect(effectiveRate({ statId: 3, points: 0 })).toBe(0);
  });
});

describe("espnScoringSettings", () => {
  it("translates a league that uses base points", () => {
    const scoring = espnScoringSettings({
      scoringItems: [
        { statId: 3, points: 0.04 },
        { statId: 4, points: 4 },
        { statId: 20, points: -2 },
        { statId: 53, points: 1 },
        { statId: 72, points: -2 },
      ],
    });

    expect(scoring).toEqual({
      pass_yd: 0.04,
      pass_td: 4,
      pass_int: -2,
      rec: 1,
      fum_lost: -2,
    });
  });

  it("translates a league that hides its passing rules in overrides", () => {
    const scoring = espnScoringSettings({
      scoringItems: [
        { statId: 3, points: 0, pointsOverrides: { "1": 0.04, "2": 0.04 } },
        { statId: 20, points: 0, pointsOverrides: { "1": -1, "2": -1 } },
        { statId: 24, points: 0.1 },
      ],
    });

    // Without the override rule the first two would read as 0 and an
    // interception would look free.
    expect(scoring?.pass_yd).toBe(0.04);
    expect(scoring?.pass_int).toBe(-1);
    expect(scoring?.rush_yd).toBe(0.1);
  });

  it("skips stat ids it has no mapping for", () => {
    const scoring = espnScoringSettings({
      scoringItems: [
        { statId: 3, points: 0.04 },
        { statId: 161, points: 10 },
      ],
    });
    expect(scoring).toEqual({ pass_yd: 0.04 });
  });

  it("is null when there is nothing usable, so callers show no number", () => {
    expect(espnScoringSettings(null)).toBeNull();
    expect(espnScoringSettings({})).toBeNull();
    expect(espnScoringSettings({ scoringItems: [] })).toBeNull();
    // Recognisable shape, but no offensive rule in it.
    expect(espnScoringSettings({ scoringItems: [{ statId: 161, points: 10 }] })).toBeNull();
  });
});
