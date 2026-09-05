/**
 * Tests for the rate limiter.
 *
 * Worth testing as pure logic rather than by hammering a running server: an
 * attempt to verify it with 125 sequential HTTP requests killed the dev server
 * and proved nothing, because a connection failure and an allowed request are
 * indistinguishable from the outside. The counting is the part that has to be
 * right, and the counting is pure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { callerKey, rateLimit } from "./rate-limit";

/** The limiter keeps its buckets on globalThis; clear them between cases. */
beforeEach(() => {
  (globalThis as { snapCountRateLimits?: unknown }).snapCountRateLimits = new Map();
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows exactly the budget, then refuses", () => {
    // The defect this catches is an off-by-one that hands out one extra call —
    // on the analysis endpoint that is a real, billed request.
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("k", 5, 60_000).allowed).toBe(true);
    }
    expect(rateLimit("k", 5, 60_000).allowed).toBe(false);
  });

  it("counts down remaining accurately", () => {
    expect(rateLimit("k", 3, 60_000).remaining).toBe(2);
    expect(rateLimit("k", 3, 60_000).remaining).toBe(1);
    expect(rateLimit("k", 3, 60_000).remaining).toBe(0);
    expect(rateLimit("k", 3, 60_000).remaining).toBe(0);
  });

  it("keeps separate budgets per key", () => {
    // A shared bucket would let one endpoint's traffic lock out another's.
    rateLimit("a", 1, 60_000);
    expect(rateLimit("a", 1, 60_000).allowed).toBe(false);
    expect(rateLimit("b", 1, 60_000).allowed).toBe(true);
  });

  it("reports a positive retry-after once refusing", () => {
    rateLimit("k", 1, 60_000);
    const denied = rateLimit("k", 1, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(0);
    expect(denied.retryAfter).toBeLessThanOrEqual(60);
  });

  it("refills when the window passes", () => {
    vi.useFakeTimers();
    rateLimit("k", 1, 1_000);
    expect(rateLimit("k", 1, 1_000).allowed).toBe(false);

    vi.advanceTimersByTime(1_001);
    expect(rateLimit("k", 1, 1_000).allowed).toBe(true);
  });

  it("does not refill early", () => {
    // The defect: a window that resets on read rather than on elapsed time,
    // which makes the limit unenforceable.
    vi.useFakeTimers();
    rateLimit("k", 1, 10_000);
    vi.advanceTimersByTime(9_000);
    expect(rateLimit("k", 1, 10_000).allowed).toBe(false);
  });

  it("bounds how many callers it tracks", () => {
    // The key derives from a caller-controlled header, so an unbounded map is
    // itself the memory leak the limiter exists to prevent.
    for (let i = 0; i < 900; i++) rateLimit(`caller-${i}`, 10, 60_000);
    const buckets = (globalThis as { snapCountRateLimits?: Map<string, unknown> })
      .snapCountRateLimits;
    expect(buckets!.size).toBeLessThanOrEqual(500);
  });

  it("survives a wrong-shaped value left on globalThis", () => {
    // A deploy that changes a cached shape can find the old one on a warm
    // instance — this exact failure took down every request earlier today.
    (globalThis as { snapCountRateLimits?: unknown }).snapCountRateLimits = {
      not: "a map",
    };
    expect(() => rateLimit("first", 1, 60_000)).not.toThrow();

    // A different key, because the first one was deliberately spent — reusing
    // it would assert that an exhausted budget refills, which is the opposite
    // of what this limiter should do.
    expect(rateLimit("second", 5, 60_000).allowed).toBe(true);
  });
});

describe("callerKey", () => {
  it("uses the first address in x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18" },
    });
    expect(callerKey(request, "scope")).toBe("scope:203.0.113.7");
  });

  it("falls back to a constant when the header is absent", () => {
    // Everyone shares one bucket rather than nobody being limited — the safe
    // direction for a cost ceiling.
    const request = new Request("https://example.com");
    expect(callerKey(request, "scope")).toBe("scope:unknown");
  });

  it("separates scopes for the same caller", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(callerKey(request, "analysis")).not.toBe(callerKey(request, "gameday"));
  });
});
