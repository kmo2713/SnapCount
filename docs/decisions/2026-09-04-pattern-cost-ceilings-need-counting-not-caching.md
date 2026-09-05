---
category: pattern
date: 2026-09-04
project: SnapCount
feature: Live Gameday
severity: high
tags: rate-limiting, caching, memoisation, abuse, amplification, ttl, public-endpoints
applies_to: backend
---

# A cache bounds duplicate work, not an enumerating caller — cost ceilings need counting

## Context

Three public endpoints fan out to expensive upstream calls: the game-day poll (~10 calls),
the drill-in (~1.4MB from ESPN per miss), and the AI analysis route (a billed Opus call).
Each had an in-process memo, and in each case the memo was described — in code comments,
in a plan's abuse-case section, and in a review response — as the thing that bounded
abuse.

It is not. In all three cases that claim was wrong.

## Decision / Finding

**A memo collapses *identical* work.** It protects against many callers asking the same
question and does nothing against one caller asking many different ones. The moment the
memo's key contains a caller-controlled parameter — `?week=`, `?season=`, an event id —
the caller chooses the access pattern, and they will choose the one that misses.

**Resizing the cache does not fix it, and this was measured rather than argued.** A
reviewer proposed widening the poll memo from 4 slots to 18, one per valid NFL week, so
that round-robining `?week=` could no longer thrash it. Implemented and tested:

- **54 round-robin requests across all 18 weeks rebuilt on all 54.**
- Only **12 of 18** entries even survived the warm-up.

The reason is structural: the memo's TTL is 15 seconds because a live scoreboard cannot
serve older data than that, and enumerating 18 keys takes longer than 15 seconds. The
short TTL that makes the cache *correct* is what makes it *useless* as a ceiling. No cap
size fixes this.

**The right tool is a fixed-window per-caller rate limiter** (`src/lib/rate-limit.ts`).
Caching answers "have I done this exact work already"; counting answers "has this caller
had enough". They are different questions and only the second bounds cost.

## Rationale

Authentication was considered and rejected for the analysis endpoint: the browser calls
it, so gating it on the sync secret would mean shipping that secret to the client. A
ceiling preserves the feature and bounds the spend, which is the actual goal — this app
has no authentication anywhere by design and that remains correct for reading public
scores.

Limits were set well above real use so they never fire in normal operation: analysis
20/hour (one person clicking through lineups uses a handful), poll 400/hour (a session
polling every 25 seconds uses ~144), drill-in 120/hour.

The limiter is per-instance rather than backed by Redis. Vercel may run several
instances, so the true ceiling is the budget times the instance count — which bounds the
damage without adding infrastructure to a personal project. The failure it prevents is an
unbounded loop, and that it does prevent.

## Impact

- Any public endpoint that spends money, egress, or a third-party quota needs a counter,
  regardless of what caching sits in front of it.
- **The comment is part of the bug.** Two code comments and one plan section asserted the
  memo bounded abuse. A wrong mental model written into a comment outlives the review that
  should have caught it, and gets copied into the next feature. When a mitigation is
  claimed in prose, the claim needs testing exactly as much as the code does.

## Action Items

- [x] `src/lib/rate-limit.ts` added, applied to all three endpoints, 11 unit tests
- [x] Corrected the comments that overstated what the memo did
- [ ] Consider a shared global bucket alongside the per-caller one if the app ever gets
      real traffic — per-IP alone is spoofable, and the header is caller-controlled

## References

- `src/lib/rate-limit.ts`, `src/lib/rate-limit.test.ts`
- `docs/reviews/2026-09-04-predeploy-production.md` — the gate that found it
- `docs/reviews/2026-09-04-review-live-gameday.md` — findings C1 and C3, where the memo
  was first (partially) blamed and (partially) fixed
