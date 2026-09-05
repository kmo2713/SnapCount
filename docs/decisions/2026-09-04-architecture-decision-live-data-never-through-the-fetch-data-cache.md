---
category: architecture-decision
date: 2026-09-04
project: SnapCount
feature: Live Gameday
severity: high
tags: nextjs, caching, live-data, stale-while-revalidate, force-dynamic, credentials, polling
applies_to: fullstack
---

# Live data never goes through Next's fetch data cache

## Context

Game day polls NFL scores and nine leagues' fantasy totals every 20-30 seconds. One
request fans out to about ten upstream calls, so the obvious first design was to let
Next's data cache collapse them: omit `dynamic`, set `next: { revalidate: 15 }` per
fetch, and let concurrent polls share a result.

## Decision / Finding

Do not use the fetch data cache for anything that must be current. Three separate
properties make it wrong for live data, and any one of them is disqualifying:

1. **It is stale-while-revalidate.** The first request past the window is served the
   *previous* value while a refresh runs behind it. For a scoreboard that means showing
   a touchdown late — the one thing this feature cannot do.
2. **`export const dynamic = "force-dynamic"` silently overrides per-fetch settings.**
   It sets `fetchCache = "force-no-store"` for the entire segment, which the docs state
   applies "even if they provide a `'force-cache'` option". A route can therefore *look*
   like it caches and provably not, with nothing in the code to say so.
3. **The cache key includes the `cookie` header.** ESPN private-league reads carry
   account cookies, so their responses would be persisted into a shared regional store.

**Decision:** live scores are passthrough. Concurrent work is collapsed by an in-process
`globalThis` memo with a short TTL — fresh rather than stale, and credentials stay in
process. History goes the other way: the day timeline is written by the sync cron, never
by the request path.

## Rationale

The alternative — accepting a 15-second stale window — was rejected because the window is
not 15 seconds. Stale-while-revalidate serves the old value *and then* refreshes, so the
worst case is two windows, and it lands exactly when traffic resumes after a quiet period,
which on a Sunday is the moment a game kicks off.

`cacheComponents: true` was also considered and rejected: it is a whole-app change
(dynamic-by-default fetching, PPR as default, `<Activity>`-based navigation) and cannot be
scoped to one feature.

Worth noting *when* this was caught: an adversarial review ran against the plan **before
any code existed**, which is why the correction cost nothing. The same finding after the
build would have meant rewriting the loader, the route, and the snapshot writer.

## Impact

- Any future live view in this app (a live draft board, an in-progress trade feed) starts
  from passthrough plus an in-process memo, not from the data cache.
- `force-dynamic` should be read as "this segment cannot cache fetches", not as a
  formality copied from a neighbouring route.
- The reasoning is recorded at the point of decision in `src/lib/data/gameday.ts` and
  `src/app/api/gameday/route.ts`, so the next reader does not re-derive it.

## Action Items

- [x] Documented in the module headers where the decision is enacted
- [ ] Re-check on the next Next.js major — cache semantics have changed twice in two
      releases, and `unstable_cache` is already documented as superseded by `use cache`

## References

- `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`
  (Next 16.3.2, the version pinned here — bundled docs are authoritative over training data)
- `docs/plans/2026-09-04-plan-live-gameday.md` — "Adversarial review" section
- `src/lib/data/gameday.ts`, `src/app/api/gameday/route.ts`
