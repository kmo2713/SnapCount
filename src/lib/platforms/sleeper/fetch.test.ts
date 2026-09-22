/**
 * Tests for which week the app shows and which weeks it fetches.
 *
 * The reported symptom was "I am not seeing any new fantasy data" on the
 * Tuesday after week 2. Two separate things caused it, and only one was the
 * scheduled sync: even after a manual sync filled week 2 in full, the dashboard
 * showed week 3 — a week nobody had played — because it read Sleeper's `week`
 * rather than its `display_week`. That is not a one-off; it is every Tuesday
 * and Wednesday of the season, which is exactly when you want to look at what
 * just happened.
 */
import { describe, expect, it } from "vitest";

import { resolveSyncWeek, resolveViewedWeek } from "./fetch";
import type { SleeperState } from "./types";

function state(over: Partial<SleeperState>): SleeperState {
  return {
    season: "2026",
    season_type: "regular",
    week: 1,
    display_week: 1,
    league_season: "2026",
    previous_season: "2025",
    season_start_date: "2026-09-09",
    leg: 1,
    ...over,
  };
}

describe("resolveViewedWeek", () => {
  it("shows the week that just finished during the Tuesday gap", () => {
    // Measured from Sleeper on the Tuesday after week 2.
    expect(resolveViewedWeek(state({ week: 3, display_week: 2 }))).toBe(2);
  });

  it("shows the live week while it is being played", () => {
    // Sunday: the two agree, so there is nothing to choose between.
    expect(resolveViewedWeek(state({ week: 2, display_week: 2 }))).toBe(2);
  });

  it("moves on once Sleeper says the next week is the one to show", () => {
    expect(resolveViewedWeek(state({ week: 3, display_week: 3 }))).toBe(3);
  });

  it("pins to week 1 in preseason, whatever week is reported", () => {
    expect(resolveViewedWeek(state({ season_type: "pre", week: 3, display_week: 3 }))).toBe(1);
  });

  it("follows the postseason", () => {
    expect(resolveViewedWeek(state({ season_type: "post", week: 16, display_week: 15 }))).toBe(15);
  });

  it("falls back to week when display_week is missing or nonsense", () => {
    // Not observed, but this is read off an undocumented API and a zero here
    // would otherwise clamp to week 1 and hide the whole season.
    expect(
      resolveViewedWeek(state({ week: 5, display_week: undefined as unknown as number })),
    ).toBe(5);
    expect(resolveViewedWeek(state({ week: 5, display_week: 0 }))).toBe(5);
  });

  it("stays inside the season", () => {
    expect(resolveViewedWeek(state({ week: 99, display_week: 99 }))).toBe(18);
    expect(resolveViewedWeek(state({ week: -3, display_week: -3 }))).toBe(1);
  });
});

describe("resolveSyncWeek", () => {
  it("fetches the week ahead during the gap, so nothing is missed", () => {
    // The asymmetry this encodes: showing an unplayed week is a bad view,
    // failing to fetch one is missing data. Only the second is unrecoverable.
    expect(resolveSyncWeek(state({ week: 3, display_week: 2 }))).toBe(3);
  });

  it("cannot be left behind if display_week lags into a live Thursday", () => {
    expect(resolveSyncWeek(state({ week: 4, display_week: 3 }))).toBe(4);
  });

  it("agrees with the viewed week whenever the two numbers agree", () => {
    for (const week of [1, 5, 12, 18]) {
      const s = state({ week, display_week: week });
      expect(resolveSyncWeek(s)).toBe(resolveViewedWeek(s));
    }
  });

  it("is never behind the viewed week", () => {
    for (const [week, display] of [
      [3, 2],
      [2, 2],
      [1, 1],
      [9, 8],
    ]) {
      const s = state({ week, display_week: display });
      expect(resolveSyncWeek(s)).toBeGreaterThanOrEqual(resolveViewedWeek(s));
    }
  });

  it("pins to week 1 in preseason", () => {
    expect(resolveSyncWeek(state({ season_type: "pre", week: 3, display_week: 2 }))).toBe(1);
  });
});
