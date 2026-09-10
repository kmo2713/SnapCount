---
category: pattern
date: 2026-09-10
project: SnapCount
feature: Live Gameday
severity: medium
tags: incremental-sync, watermark, pagination, idempotency, espn, cost
applies_to: backend
---

# A row count is a watermark; a filtered row count is not

## Context

The play ledger reads ESPN's play feed incrementally. The feed is ~774KB for
one finished game, so re-reading thirteen live games every ten minutes for
seven hours is gigabytes for the sake of a few hundred new plays. ESPN reports
a game's play `count` for 1.7KB, which makes "am I behind?" cheap to ask:

```ts
const remote = await fetchPlayCount(eventId);          // 1.7KB
const pages = pagesToFetch(remote, have.get(eventId)); // usually []
```

`have` came from counting the ledger's own rows for that game. The ledger, very
sensibly, stored only the plays that touched the user's rosters — the ones it
exists to rank. 97 of the game's 180 plays.

## Decision / Finding

The first run inserted 97 rows and reported success. The second run, with
nothing whatsoever having changed, fetched two more pages:

```
run 1: {"probed":1,"fetched":1,"pages":4,"inserted":97}
run 2: {"probed":1,"fetched":1,"pages":2,"inserted":0}   ← should be 0 pages
```

97 is not comparable to 180. The ledger was permanently 83 rows "behind" a
game it had read completely, and would have re-fetched two pages every ten
minutes forever — inserting nothing, every time.

**A watermark has to count the same things the remote counts.** The filter and
the watermark were the same number serving two purposes, and the moment they
diverged the comparison became meaningless while still looking sound.

The fix is to store every play in the feed — kickoffs, timeouts, plays
involving nobody — and filter on read instead:

```sql
isNotNull(wallclock) AND impact ? :leagueId AND abs((impact ->> :leagueId)::numeric) > 0
```

180 rows in, matching ESPN exactly, and the second run fetches nothing.

## The alternative, and why not

A cursor table — "ESPN said 180 when we last read this game" — is the precise
fix and was the first instinct. It was rejected for a specific reason: it is a
second source of truth that can outlive the thing it describes. If the cursor
write succeeds and the row insert fails, the cursor says "done" for plays that
are not there, and nothing ever looks again.

Counting rows cannot drift from reality, because the rows *are* the reality. A
partial insert leaves the count low, and the next cycle re-reads the tail and
fills the gap. Self-healing beat precise.

## Cost of the breadth

~180 rows per game instead of ~97, so roughly 2,400 rows per Sunday against
1,300. Postgres does not notice, and the extra rows turned out to be useful in
their own right: the ledger is now a complete record of the games you had a
stake in, not just a highlight reel.

## Rules going forward

1. **Never let a filtered count double as a watermark.** If the local number is
   compared against a remote one, they must be counting the same population.
   Filter on read, or keep a count that matches.
2. **Prefer a self-healing watermark to an exact one.** A derived count that can
   only be wrong in the direction of doing extra work beats a stored cursor
   that can be wrong in the direction of losing data.
3. **Verify idempotency by running twice and asserting the second run is
   free.** The first run looked perfect. Only the second run's `pages: 2` showed
   anything was wrong, and nothing about the data would ever have revealed it.

## Related

- [2026-09-04 — A cache bounds duplicate work, not an enumerating caller](2026-09-04-pattern-cost-ceilings-need-counting-not-caching.md)
  — the same shape of mistake: a number that looked like it bounded cost and
  did not, found by measuring the second call rather than the first.
