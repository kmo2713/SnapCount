/**
 * Tests for the box score's category pairing.
 *
 * The layout puts one team in each column and relies on both columns walking
 * the same list of categories in the same order. Real payloads are not
 * symmetric — a live NE @ SEA had 7 categories for one team and 9 for the
 * other — and if a category only one side recorded were skipped rather than
 * left blank, every heading below it would sit beside the wrong numbers. That
 * is a defect you would read as merely surprising stats rather than as a bug.
 */
import { describe, expect, it } from "vitest";

import type { BoxScoreTeam } from "@/lib/domain/gameday";
import { pairedCategoryNames } from "./GameDrillIn";

function team(abbr: string, ...categories: string[]): BoxScoreTeam {
  return {
    abbr,
    categories: categories.map((name) => ({ name, labels: [], players: [] })),
  };
}

describe("pairedCategoryNames", () => {
  it("keeps the first team's order", () => {
    expect(
      pairedCategoryNames([
        team("NE", "passing", "rushing", "receiving"),
        team("SEA", "passing", "rushing", "receiving"),
      ]),
    ).toEqual(["passing", "rushing", "receiving"]);
  });

  it("includes a category only the second team recorded", () => {
    // The measured NE @ SEA case: SEA had interceptions, NE had none.
    expect(
      pairedCategoryNames([
        team("NE", "passing", "defensive"),
        team("SEA", "passing", "defensive", "interceptions"),
      ]),
    ).toEqual(["passing", "defensive", "interceptions"]);
  });

  it("includes a category only the first team recorded", () => {
    expect(
      pairedCategoryNames([
        team("NE", "passing", "puntReturns"),
        team("SEA", "passing"),
      ]),
    ).toEqual(["passing", "puntReturns"]);
  });

  it("never repeats a category both teams recorded", () => {
    const names = pairedCategoryNames([
      team("NE", "passing", "rushing"),
      team("SEA", "rushing", "passing"),
    ]);
    expect(names).toEqual(["passing", "rushing"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("is empty for a game with nothing recorded, so the section can be dropped", () => {
    expect(pairedCategoryNames([team("NE"), team("SEA")])).toEqual([]);
    expect(pairedCategoryNames([])).toEqual([]);
  });
});
