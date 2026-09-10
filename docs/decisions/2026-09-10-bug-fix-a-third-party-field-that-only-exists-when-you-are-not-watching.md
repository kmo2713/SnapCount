---
category: bug-fix
date: 2026-09-10
project: SnapCount
feature: Live Gameday
severity: high
tags: espn, third-party-api, live-data, null-vs-zero, silent-failure, undocumented-api, test-coverage
applies_to: backend
---

# A third-party field that only exists when you are not watching

## Context

ESPN reports a fantasy team's weekly score in `schedule[].home/away.pointsByScoringPeriod`,
a map of scoring period to points. That was read off live payloads, verified against every
completed 2025 matchup, and it was correct — for closed weeks.

On a live week 1, both ESPN leagues showed no score whatsoever while the seven Sleeper
leagues ticked along normally. The reported symptom was "espn leagues arent updating".

Measured on the live payload, with Wednesday's opener already final:

| field | value |
| --- | --- |
| `pointsByScoringPeriod` | `undefined` on all 12 teams |
| `totalPoints` | `0` on all 12 teams |
| `gamesPlayed` | `0` on all 12 teams |
| individual player actuals | populated — one player on 26.2 |

So the players had points, the team had none, and every field that looked like a team
total agreed on zero.

## Decision / Finding

`rosterForCurrentScoringPeriod.appliedStatTotal` is the field ESPN populates while a
period is being played. It is preferred over summing the starters ourselves because it is
still ESPN's own arithmetic: measured against that live week it equalled the starter total
exactly on all 12 teams, and excluded a bench holding 7.00 points.

Both fields are read, closed period first:

```ts
points:
  side.pointsByScoringPeriod?.[String(matchupPeriod)] ??
  side.rosterForCurrentScoringPeriod?.appliedStatTotal ??
  null,
```

Order matters in one direction only: if the live field won, every completed week would
quietly rewrite itself on the next sync.

`rosterForMatchupPeriod.appliedStatTotal` also matches when present, but it is absent for
a team on zero points, so it cannot be the primary read.

## Consequences

- Live ESPN scores work, and completed weeks resync byte-for-byte identical.
- `EspnMatchupSide` now carries a comment on each score field saying *when* it exists,
  not just what it means. For an undocumented API that is the load-bearing half.

## Why this survived every check

Nothing was broken in a way anything could see. Typecheck passed, lint passed, 69 tests
passed, and every `sync_runs` row logged `success` with a plausible `matchups=24`. The
sync did exactly what it was told, on a field that had genuinely worked when it was
written.

The reason is that **`null` and `0` are the same answer to "did this work?"** A team that
has not kicked off yet really does have no points, so a reader returning nothing is
indistinguishable from a quiet week — unless something asserts the difference. The
normalizer, the most format-sensitive module in the codebase, had no tests at all; it was
verified once by eye against a payload and then trusted.

## Rules going forward

1. **A third-party field verified against historical data is verified for historical
   data only.** Anything whose value depends on an upstream state machine — in-progress
   vs. final, open vs. closed — has to be observed in each state before it is trusted.
   Season-long archives are the easiest thing to test against and the least
   representative of a live Sunday.
2. **Record when a field exists, beside what it holds.** Both score fields now carry that
   in their doc comment, with the measurement that established it.
3. **Assert that live data is non-empty somewhere.** A sync that writes 24 rows of `null`
   and reports success is worse than one that fails, because the failure would have been
   noticed on Sep 4 rather than on a live Sunday.
4. **Test the normalizer directly.** Same lesson as the rate-limit entry: pure logic gets
   pure tests. The seven cases in `normalize.test.ts` each take microseconds and would
   have caught this before it shipped.

## Related

- [2026-09-04 — Verifying a guard end-to-end proved nothing and hid a dead server](2026-09-04-ai-mistake-end-to-end-check-that-could-not-tell-allowed-from-dead.md)
  — the same mistake from the other side: a check that could not distinguish success from
  failure.
