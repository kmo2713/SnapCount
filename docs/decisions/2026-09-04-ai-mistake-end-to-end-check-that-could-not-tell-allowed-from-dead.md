---
category: ai-mistake
date: 2026-09-04
project: SnapCount
feature: Live Gameday
severity: medium
tags: verification, testing, curl, false-negative, shell-escaping, rate-limiting, evidence
applies_to: process
---

# Verifying a guard end-to-end proved nothing and hid a dead server

## Context

A rate limiter had just been added to bound abuse of three public endpoints. To prove the
120/hour drill-in limit actually fired, I fired 125 sequential requests at `next dev` with
`curl` in a shell loop, counting responses:

```sh
c=$(curl -s -o /dev/null -w "%{http_code}" "$URL/api/gameday/game/40177293$((i % 10))")
if [ "$c" = "429" ]; then limited=$((limited+1)); else ok=$((ok+1)); fi
```

Result: `non-429: 125   429: 0`. I was one step from reporting "the limiter does not work."

## Decision / Finding

**Both halves of the test were wrong, and they concealed each other.**

1. `curl` returns HTTP `000` on a dropped connection. The check counted anything that was
   not `429` as allowed, so **connection failures were scored as successes**.
2. The dev server had actually died partway through — 125 sequential requests each
   hitting ESPN for ~1.4MB was more than it survived. The later "successes" were the
   server being gone.

So the test could not distinguish *allowed*, *refused*, and *server dead*. A check that
cannot tell those apart is not evidence of anything, and it was about to produce a
confidently false conclusion about working code.

**What it should have been:** the counting logic is pure. Test it directly.

Replaced with 11 unit tests over `rateLimit()` and `callerKey()` — exact budget then
refusal, no early refill, per-key isolation, bounded tracking, and a positive
`retry-after`. They run in milliseconds, need no server, and each names the defect it
catches.

## Rationale

The pull toward an end-to-end check was "prove it really works in the real system", which
is a good instinct pointed at the wrong layer. The uncertain part of a rate limiter is
arithmetic — off-by-one on the budget, a window that resets on read rather than on
elapsed time — and none of that needs a network. What the end-to-end run would genuinely
have added (does the route wire the limiter in at all?) it did not actually verify either,
because it could not read its own failures.

**The general rule: when verifying a guard, test the pure logic directly. Reach for
end-to-end only when the integration itself is the thing in doubt — and when it can tell a
failure from a pass.**

## Related mistake, same session, same shape

A regex was silently mangled by shell escaping while being written through a `node -e`
one-liner: `/^\d{6,12}$/` landed in the file as `/^d{6,12}$/`, which matches the letter
`d` and would have rejected every real ESPN event id — breaking the entire drill-in.
Typecheck passed, lint passed, tests passed, because nothing exercised that path.

It was caught only by reading the written file back. **Never assume an edit landed as
typed**, particularly through a shell layer: backslashes, apostrophes and backticks are
all live ammunition. Prefer a real editing tool over `node -e` string surgery for anything
containing escapes, and read back what was written.

## Impact

- Guards, limiters, validators and parsers get unit tests over the pure logic, not shell
  loops against a dev server.
- A verification step that cannot distinguish its failure modes should be treated as no
  verification at all — worse than none, because it produces false confidence.
- Any file edited through a shell one-liner gets read back before it is believed.

## Action Items

- [x] Replaced the shell loop with 11 unit tests
- [x] Read back and fixed the mangled regex
- [ ] Prefer `Edit`/`Write` over `node -e` for content with escape sequences

## References

- `src/lib/rate-limit.test.ts`
- `src/lib/data/gameday-detail.ts` — the `^\d{6,12}$` guard that was briefly `^d{6,12}$`
- `docs/reviews/2026-09-04-predeploy-production.md` — "What the gate changed"
