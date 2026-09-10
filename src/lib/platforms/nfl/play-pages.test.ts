/**
 * Tests for the tail-fetch page arithmetic.
 *
 * This decides what the ledger reads, so an off-by-one here either misses
 * plays permanently — the ledger's count moves on and never looks back — or
 * re-reads the whole game every five minutes. Neither would be visible: the
 * first looks like a quiet afternoon, the second like a slow sync.
 */
import { describe, expect, it } from "vitest";

import { pagesToFetch, shouldProbe } from "./play-pages";

describe("pagesToFetch", () => {
  it("asks for nothing when the ledger is level", () => {
    expect(pagesToFetch(180, 180)).toEqual([]);
  });

  it("asks for nothing when the ledger is somehow ahead", () => {
    // A play withdrawn upstream leaves us holding more than ESPN reports.
    // Re-reading the game would not remove it, so there is nothing to gain.
    expect(pagesToFetch(178, 180)).toEqual([]);
  });

  it("asks for nothing about a game with no plays yet", () => {
    expect(pagesToFetch(0, 0)).toEqual([]);
  });

  it("fetches only the last page for a handful of new plays", () => {
    // 180 plays over 4 pages of 50; five new plays plus the margin fit in one.
    expect(pagesToFetch(180, 175)).toEqual([4]);
  });

  it("reaches back a page when the gap plus margin crosses a boundary", () => {
    // 45 missing plus 10 margin is 55, which does not fit one page of 50.
    expect(pagesToFetch(180, 135)).toEqual([3, 4]);
  });

  it("never asks for more pages than exist", () => {
    // A cold ledger on a finished game: every page, and no page zero.
    expect(pagesToFetch(180, 0)).toEqual([1, 2, 3, 4]);
    expect(pagesToFetch(30, 0)).toEqual([1]);
  });

  it("returns pages oldest first, so inserts happen in play order", () => {
    const pages = pagesToFetch(500, 100);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
  });

  it("always includes the newest page, which is where new plays land", () => {
    for (const have of [0, 1, 99, 179]) {
      const pages = pagesToFetch(180, have);
      expect(pages[pages.length - 1]).toBe(4);
    }
  });

  it("applies the margin so the measured one-position disorder cannot hide a play", () => {
    // One new play still re-reads enough to cover a neighbour that swapped.
    const pages = pagesToFetch(180, 179);
    expect(pages).toEqual([4]);
    // With a page boundary right at the gap, the margin pulls in the page
    // before it rather than trusting the boundary.
    expect(pagesToFetch(200, 199)).toEqual([4]);
  });

  it("honours a custom page size", () => {
    expect(pagesToFetch(100, 90, 25, 0)).toEqual([4]);
    expect(pagesToFetch(100, 50, 25, 0)).toEqual([3, 4]);
  });
});

describe("shouldProbe", () => {
  it("probes live games", () => {
    expect(shouldProbe("in")).toBe(true);
  });

  it("still probes finished games, whose last plays arrive after the flip", () => {
    expect(shouldProbe("post")).toBe(true);
  });

  it("skips a game that has not started", () => {
    expect(shouldProbe("pre")).toBe(false);
  });
});
