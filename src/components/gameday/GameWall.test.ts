/**
 * Tests for the kickoff-window ordering.
 *
 * These exist because the behaviour that matters cannot be seen today. Every
 * game this week is `pre`, so the running order falls back to plain chronology
 * and looks identical either way — the reordering only shows itself on a Sunday
 * afternoon, when some windows are live and others are finished. Waiting until
 * then to find out is how a scoreboard opens on the wrong thing at noon.
 */
import { describe, expect, it } from "vitest";

import type { GameState, NflGame } from "@/lib/domain/gameday";
import { orderWindows } from "./GameWall";

/** Minimal game — only kickoff and state affect ordering. */
function game(eventId: string, kickoff: string, state: GameState): NflGame {
  return {
    eventId,
    shortName: eventId,
    kickoff,
    state,
    statusDetail: "",
    home: { abbr: "HOM", name: "Home", score: null, record: null },
    away: { abbr: "AWY", name: "Away", score: null, record: null },
    situation: null,
    broadcast: null,
  };
}

const WED = "2026-09-10T00:20Z";
const SUN_NOON = "2026-09-13T17:00Z";
const SUN_LATE = "2026-09-13T20:25Z";
const MON = "2026-09-15T00:15Z";

describe("orderWindows", () => {
  it("groups games that share a kickoff into one window", () => {
    const windows = orderWindows([
      game("a", SUN_NOON, "pre"),
      game("b", SUN_NOON, "pre"),
      game("c", SUN_LATE, "pre"),
    ]);

    expect(windows).toHaveLength(2);
    expect(windows[0][1]).toHaveLength(2);
  });

  it("falls back to chronology when nothing has started", () => {
    // This is today: the whole slate is upcoming, so the order is the schedule.
    const windows = orderWindows([
      game("sun", SUN_NOON, "pre"),
      game("wed", WED, "pre"),
    ]);
    expect(windows.map((w) => w[1][0].eventId)).toEqual(["wed", "sun"]);
  });

  it("puts a live window first, ahead of an earlier finished one", () => {
    // The defect this catches: Sunday noon kicks off and the page still leads
    // with Wednesday's completed opener, pushing eight live games off screen.
    const windows = orderWindows([
      game("wed", WED, "post"),
      game("sun", SUN_NOON, "in"),
      game("mon", MON, "pre"),
    ]);
    expect(windows.map((w) => w[1][0].eventId)).toEqual(["sun", "mon", "wed"]);
  });

  it("ranks a window live when any single game in it is live", () => {
    const windows = orderWindows([
      game("done", WED, "post"),
      game("a", SUN_NOON, "post"),
      game("b", SUN_NOON, "in"),
    ]);
    expect(windows[0][0]).toBe(SUN_NOON);
  });

  it("orders upcoming windows soonest-first", () => {
    const windows = orderWindows([
      game("mon", MON, "pre"),
      game("sun", SUN_NOON, "pre"),
      game("live", SUN_LATE, "in"),
    ]);
    expect(windows.map((w) => w[1][0].eventId)).toEqual(["live", "sun", "mon"]);
  });

  it("orders finished windows newest-first", () => {
    // Once a window is over, the most recent result is the interesting one.
    const windows = orderWindows([
      game("wed", WED, "post"),
      game("sunNoon", SUN_NOON, "post"),
    ]);
    expect(windows.map((w) => w[1][0].eventId)).toEqual(["sunNoon", "wed"]);
  });

  it("returns nothing for an empty slate", () => {
    expect(orderWindows([])).toEqual([]);
  });
});
