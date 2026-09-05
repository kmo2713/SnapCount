/**
 * Tests for the scoreboard normalizer.
 *
 * Run against a captured payload rather than the live endpoint, so the suite
 * stays hermetic — the repo's CI note is explicit that a gate depending on a
 * third party fails for reasons unrelated to the commit.
 *
 * `scoreboard-final.json` is a real ESPN response (2025 week 2), trimmed to the
 * fields this module reads and kept to three games, one of which is Washington
 * so the WSH/WAS normalisation is covered by real data rather than by a
 * hand-written string.
 *
 * The in-progress cases below are SYNTHETIC and that matters. A completed game
 * carries no `situation` object at all — 0 of 16 on a finished slate — so the
 * live shape cannot be captured from history. These encode ESPN's documented
 * field names and are the part of this module most likely to be wrong. Re-verify
 * against a genuinely live game before trusting the red-zone radar.
 */
import { describe, expect, it } from "vitest";

import finalSlate from "./__fixtures__/scoreboard-final.json";
import { normalizeScoreboard, type EspnScoreboardResponse } from "./scoreboard";

const FINAL = finalSlate as EspnScoreboardResponse;

describe("normalizeScoreboard — a completed slate", () => {
  it("reads every game with no warnings", () => {
    const { games, warnings } = normalizeScoreboard(FINAL);
    expect(games).toHaveLength(3);
    expect(warnings).toEqual([]);
  });

  it("normalises Washington so its players can join to our roster rows", () => {
    // Keyed on ESPN's own spelling, WAS players fail to match at all — which
    // is silent, and costs a whole team's worth of rooting interest.
    const { games } = normalizeScoreboard(FINAL);
    const abbrs = games.flatMap((g) => [g.home.abbr, g.away.abbr]);
    expect(abbrs).toContain("WAS");
    expect(abbrs).not.toContain("WSH");
  });

  it("keeps scores for a finished game and reports the overall record only", () => {
    const { games } = normalizeScoreboard(FINAL);
    const game = games.find((g) => g.shortName.includes("GB"));
    expect(game?.state).toBe("post");
    expect(game?.home.score).toBe(27);
    expect(game?.away.score).toBe(18);
    // ESPN ships home/road splits alongside the overall record; picking the
    // wrong one shows "0-0" for a team that has played.
    expect(game?.home.record).toBe("2-0");
  });

  it("carries no situation for a game that is not being played", () => {
    // The invariant that lets a component treat "has a situation" and "is
    // live" as the same question.
    const { games } = normalizeScoreboard(FINAL);
    expect(games.every((g) => g.situation === null)).toBe(true);
  });

  it("orders games by kickoff", () => {
    const { games } = normalizeScoreboard(FINAL);
    const kickoffs = games.map((g) => g.kickoff);
    expect([...kickoffs].sort()).toEqual(kickoffs);
  });

  it("reads the broadcast network", () => {
    const { games } = normalizeScoreboard(FINAL);
    expect(games.some((g) => g.broadcast !== null)).toBe(true);
  });
});

describe("normalizeScoreboard — pregame", () => {
  it("reports no score rather than zero before kickoff", () => {
    // ESPN sends "0" pregame. Rendering that as a real zero claims a team has
    // been held scoreless when nobody has played; `fmt` renders null as a dash.
    const { games } = normalizeScoreboard({
      events: [
        {
          id: "1",
          date: "2026-09-13T17:00Z",
          shortName: "TB @ CIN",
          status: { type: { state: "pre", shortDetail: "1:00 PM" } },
          competitions: [
            {
              competitors: [
                { homeAway: "home", score: "0", team: { id: "4", abbreviation: "CIN" } },
                { homeAway: "away", score: "0", team: { id: "27", abbreviation: "TB" } },
              ],
            },
          ],
        },
      ],
    });

    expect(games[0].home.score).toBeNull();
    expect(games[0].away.score).toBeNull();
    expect(games[0].state).toBe("pre");
  });
});

describe("normalizeScoreboard — live (SYNTHETIC shapes, unverified)", () => {
  /** A live game with the situation fields ESPN is documented to send. */
  function liveGame(situation: Record<string, unknown>): EspnScoreboardResponse {
    return {
      events: [
        {
          id: "42",
          date: "2026-09-13T17:00Z",
          shortName: "WSH @ GB",
          status: {
            displayClock: "2:47",
            period: 3,
            type: { state: "in", shortDetail: "3rd Quarter" },
          },
          competitions: [
            {
              competitors: [
                { id: "9", homeAway: "home", score: "17", team: { id: "9", abbreviation: "GB" } },
                { id: "28", homeAway: "away", score: "10", team: { id: "28", abbreviation: "WSH" } },
              ],
              situation,
            },
          ],
        },
      ],
    };
  }

  it("resolves possession from a team id to an abbreviation", () => {
    // `possession` is a team id, not an abbreviation — the one field here that
    // needs resolving. Passing it straight through would show "9" in the UI.
    const { games } = normalizeScoreboard(
      liveGame({ possession: "9", isRedZone: true, downDistanceText: "3rd & 7" }),
    );

    expect(games[0].situation).not.toBeNull();
    expect(games[0].situation?.possession).toBe("GB");
    expect(games[0].situation?.isRedZone).toBe(true);
    expect(games[0].situation?.downDistance).toBe("3rd & 7");
    expect(games[0].situation?.clock).toBe("2:47");
    expect(games[0].situation?.period).toBe(3);
  });

  it("normalises possession through the same abbreviation map", () => {
    const { games } = normalizeScoreboard(liveGame({ possession: "28" }));
    expect(games[0].situation?.possession).toBe("WAS");
  });

  it("treats a missing red-zone flag as false, never as unknown", () => {
    // The radar must not light up on absence.
    const { games } = normalizeScoreboard(liveGame({ possession: "9" }));
    expect(games[0].situation?.isRedZone).toBe(false);
  });

  it("survives a situation with none of its optional fields", () => {
    const { games } = normalizeScoreboard(liveGame({}));
    expect(games[0].situation).not.toBeNull();
    expect(games[0].situation?.possession).toBeNull();
    expect(games[0].situation?.downDistance).toBeNull();
    expect(games[0].situation?.lastPlay).toBeNull();
  });

  it("ignores a situation on a game that is not live", () => {
    const payload = liveGame({ possession: "9", isRedZone: true });
    payload.events![0].status!.type!.state = "post";
    const { games } = normalizeScoreboard(payload);
    expect(games[0].situation).toBeNull();
  });

  it("falls back to the short down-and-distance when the long form is absent", () => {
    const { games } = normalizeScoreboard(liveGame({ shortDownDistanceText: "3&7" }));
    expect(games[0].situation?.downDistance).toBe("3&7");
  });
});

describe("normalizeScoreboard — degenerate payloads", () => {
  it("returns nothing for an empty payload", () => {
    expect(normalizeScoreboard({})).toEqual({ games: [], warnings: [] });
  });

  it("drops an event with no id and says so", () => {
    // Everything downstream keys on the event id; a game we cannot address is
    // worse than a game we do not show.
    const { games, warnings } = normalizeScoreboard({ events: [{ shortName: "X @ Y" }] });
    expect(games).toHaveLength(0);
    expect(warnings[0]).toContain("no event id");
  });

  it("does not throw on an event with no competitors", () => {
    const { games } = normalizeScoreboard({
      events: [{ id: "1", status: { type: { state: "in" } } }],
    });
    expect(games[0].home.name).toBe("Unknown");
    expect(games[0].home.score).toBeNull();
    expect(games[0].situation).toBeNull();
  });

  it("falls back to the second competitor when homeAway is missing", () => {
    const { games } = normalizeScoreboard({
      events: [
        {
          id: "1",
          status: { type: { state: "post" } },
          competitions: [
            {
              competitors: [
                { score: "20", team: { abbreviation: "KC" } },
                { score: "17", team: { abbreviation: "NO" } },
              ],
            },
          ],
        },
      ],
    });
    expect(games[0].home.abbr).toBe("KC");
    expect(games[0].away.abbr).toBe("NO");
  });
});
