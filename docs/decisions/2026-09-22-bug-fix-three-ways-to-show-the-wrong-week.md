---
category: bug-fix
date: 2026-09-22
project: SnapCount
feature: Dashboard / Gameday
severity: high
tags: sleeper, week-resolution, fallbacks, caching-failures, staleness, undocumented-api
applies_to: backend
---

# Three ways to show the wrong week

## Context

Reported the Tuesday after week 2: *"I am not seeing any new fantasy data."*

Three separate causes, all producing the identical symptom — a page of zeroes
that looks exactly like a broken sync. Only the first was the one already known
about.

## 1. The sync had not run in twelve days

`sync_runs` had nothing since Sep 10. The scheduled GitHub Actions workflow has
still never fired, because `SNAP_COUNT_URL` and `SYNC_SECRET` were never set as
repository secrets. A manual `npm run sync` backfilled every missing week in 47
seconds — the sync fetches weeks 1..N rather than only the current one, so
nothing was lost by the gap.

Not a code defect, and nothing in the code can fix it.

## 2. The app showed `week`, Sleeper's own app shows `display_week`

With the data fully synced, the dashboard still showed nothing — because it was
displaying **week 3**, which nobody had played yet.

```json
{"week":3,"display_week":2,"season_type":"regular"}
```

Sleeper rolls `week` forward on Tuesday morning the moment Monday night goes
final, but holds `display_week` on the week that just finished until the next
one is close. Sleeper's own app reads `display_week`. We read `week`.

That is not a one-off: it is **every Tuesday and Wednesday of the season** —
precisely the days you most want to look at what just happened.

The two questions turn out to be different, and the mistakes are not
symmetrical:

- **Which week do I show?** `display_week`. Showing an unplayed week is a bad
  view.
- **Which weeks do I fetch?** `max(week, display_week)`. Failing to fetch is
  missing data, and on a Thursday evening `display_week` may still lag while
  games are live.

So `resolveViewedWeek` prefers `display_week`, and a new `resolveSyncWeek`
takes whichever is further ahead. Every sync path uses the second.

## 3. A failed lookup was cached, and its fallback was a guess

Even after that, `/gameday` reported **week 1** while the dashboard correctly
reported week 2. Same resolver, opposite answers.

The gameday loader memoises the NFL state for five minutes:

```ts
const state = await sleeper.getState();
globalForGameday.snapCountNflState = { state, fetchedAt: Date.now() };
```

`state` can be `null`. One transient miss — most likely on the very first
render after a cold start — cached that `null` as though it were an answer, and
for the next five minutes every request took the fallback branch:

```ts
const week = options.week ?? (state ? resolveViewedWeek(state) : 1);
```

Two compounding faults:

- **A failure was memoised as a result.** Only a real answer is stored now; a
  null falls through to last-known-good.
- **The fallback was the literal `1`.** The app already holds the answer in its
  own `nfl_state` table, written by the sync and usually minutes old. Guessing
  week 1 in late September empties every panel on the page.

The dashboard was immune the whole time for one reason: it reads state from
Postgres, never from Sleeper. The two paths disagreeing by twelve days is what
made this findable.

## Rules going forward

1. **Never cache a failure alongside successes.** A memo that stores `null` on
   the same terms as a value converts a one-second blip into a five-minute
   outage, silently — there was no error in the log, and the page returned 200
   with a full payload the whole time.
2. **A fallback should be the best answer available, not a constant.** `: 1`
   reads as harmless in isolation. It is a guess standing in front of a
   database row that knows.
3. **When two code paths answer the same question, make them share the
   answer.** The dashboard and gameday resolved "what week is it" from
   different sources and disagreed for twelve days without anything failing.
4. **An undocumented API's near-duplicate fields are never redundant.** `week`
   and `display_week` differ for about 40% of the calendar. Read what the
   provider's own client reads.

## Related

- [2026-09-10 — A third-party field that only exists when you are not watching](2026-09-10-bug-fix-a-third-party-field-that-only-exists-when-you-are-not-watching.md)
  — the same provider-field lesson from the ESPN side, and the same failure
  shape: plausible data, no error, quietly wrong.
