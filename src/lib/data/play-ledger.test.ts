/**
 * Tests for assigning ledger plays to swing windows.
 *
 * This is where attribution can go quietly wrong. A window that is off by one
 * sample names the plays that happened *next*, which reads perfectly
 * plausibly — five minutes of football always contains something worth
 * blaming — and there is nothing in the output to suggest it is wrong.
 */
import { describe, expect, it } from "vitest";

import { assignToWindows, WALLCLOCK_TOLERANCE_MS, type AttributedPlay } from "./play-ledger";

let seq = 0;
function play(at: string, net: number): AttributedPlay {
  return {
    playId: `p${seq++}`,
    eventId: "401872656",
    wallclock: at,
    period: 4,
    clock: "9:25",
    teamAbbr: "NE",
    text: "D.Maye pass INTERCEPTED",
    scoringPlay: false,
    net,
  };
}

const window = (from: string, to: string) => ({ from: new Date(from), to: new Date(to) });

describe("assignToWindows", () => {
  it("keys each window by its end, which is where the swing is reported", () => {
    const to = "2026-09-10T02:10:00Z";
    const result = assignToWindows(
      [play("2026-09-10T02:07:00Z", -11.5)],
      [window("2026-09-10T02:05:00Z", to)],
      3,
    );
    expect([...result.keys()]).toEqual([Date.parse(to)]);
    expect(result.get(Date.parse(to))).toHaveLength(1);
  });

  it("keeps a play inside the window", () => {
    const result = assignToWindows(
      [play("2026-09-10T02:07:30Z", -11.5)],
      [window("2026-09-10T02:05:00Z", "2026-09-10T02:10:00Z")],
      3,
    );
    expect(result.get(Date.parse("2026-09-10T02:10:00Z"))?.[0]?.net).toBe(-11.5);
  });

  it("excludes a play after the window closes", () => {
    // The failure that would look right: blaming the next thing that happened.
    const result = assignToWindows(
      [play("2026-09-10T02:11:00Z", -11.5)],
      [window("2026-09-10T02:05:00Z", "2026-09-10T02:10:00Z")],
      3,
    );
    expect(result.get(Date.parse("2026-09-10T02:10:00Z"))).toEqual([]);
  });

  it("reaches back by the tolerance, because wallclock runs out of order", () => {
    // Measured: ESPN's wallclock can sit up to ~227s behind feed position, so
    // a play just before the window's start still belongs to it.
    const justBefore = new Date(
      Date.parse("2026-09-10T02:05:00Z") - WALLCLOCK_TOLERANCE_MS + 1000,
    ).toISOString();

    const result = assignToWindows(
      [play(justBefore, -11.5)],
      [window("2026-09-10T02:05:00Z", "2026-09-10T02:10:00Z")],
      3,
    );
    expect(result.get(Date.parse("2026-09-10T02:10:00Z"))).toHaveLength(1);
  });

  it("does not reach back further than the tolerance", () => {
    const wellBefore = new Date(
      Date.parse("2026-09-10T02:05:00Z") - WALLCLOCK_TOLERANCE_MS - 1000,
    ).toISOString();

    const result = assignToWindows(
      [play(wellBefore, -11.5)],
      [window("2026-09-10T02:05:00Z", "2026-09-10T02:10:00Z")],
      3,
    );
    expect(result.get(Date.parse("2026-09-10T02:10:00Z"))).toEqual([]);
  });

  it("caps each window at the requested count", () => {
    const plays = [
      play("2026-09-10T02:06:00Z", -11.5),
      play("2026-09-10T02:07:00Z", -6.1),
      play("2026-09-10T02:08:00Z", -2),
      play("2026-09-10T02:09:00Z", -1),
    ];
    const result = assignToWindows(
      plays,
      [window("2026-09-10T02:05:00Z", "2026-09-10T02:10:00Z")],
      2,
    );
    expect(result.get(Date.parse("2026-09-10T02:10:00Z"))).toHaveLength(2);
  });

  it("preserves the order it was given, which is biggest impact first", () => {
    // The query sorts by absolute impact; slicing must not reshuffle that, or
    // a cap of three would keep three arbitrary plays instead of the top three.
    const plays = [
      play("2026-09-10T02:09:00Z", -11.5),
      play("2026-09-10T02:06:00Z", -2),
    ];
    const result = assignToWindows(
      plays,
      [window("2026-09-10T02:05:00Z", "2026-09-10T02:10:00Z")],
      3,
    );
    expect(result.get(Date.parse("2026-09-10T02:10:00Z"))?.map((p) => p.net)).toEqual([
      -11.5, -2,
    ]);
  });

  it("can offer one play to two adjacent windows", () => {
    /*
     * A consequence of the tolerance, and honest: we cannot place a play more
     * precisely than ESPN timestamps it, so a play near a boundary genuinely
     * might belong to either five minutes.
     */
    const shared = play("2026-09-10T02:09:00Z", -11.5);
    const result = assignToWindows(
      [shared],
      [
        window("2026-09-10T02:05:00Z", "2026-09-10T02:10:00Z"),
        window("2026-09-10T02:10:00Z", "2026-09-10T02:15:00Z"),
      ],
      3,
    );
    expect(result.get(Date.parse("2026-09-10T02:10:00Z"))).toHaveLength(1);
    expect(result.get(Date.parse("2026-09-10T02:15:00Z"))).toHaveLength(1);
  });

  it("gives every window an entry, even an empty one", () => {
    // The view distinguishes "no play of yours in this window" from "we did
    // not look", so a missing key and an empty list are not the same thing.
    const result = assignToWindows(
      [],
      [window("2026-09-10T02:05:00Z", "2026-09-10T02:10:00Z")],
      3,
    );
    expect(result.has(Date.parse("2026-09-10T02:10:00Z"))).toBe(true);
    expect(result.get(Date.parse("2026-09-10T02:10:00Z"))).toEqual([]);
  });

  it("returns nothing for no windows", () => {
    expect(assignToWindows([play("2026-09-10T02:06:00Z", -1)], [], 3).size).toBe(0);
  });
});
