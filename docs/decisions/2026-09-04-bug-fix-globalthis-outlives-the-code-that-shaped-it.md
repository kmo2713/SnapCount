---
category: bug-fix
date: 2026-09-04
project: SnapCount
feature: Live Gameday
severity: high
tags: globalthis, memoisation, serverless, deploys, nullish-assignment, shape-migration
applies_to: backend
---

# `globalThis` outlives the code that shaped it, and `??=` preserves the old shape

## Context

The game-day poll memo started as a single object on `globalThis`:

```ts
snapCountGameday?: { key: string; data: GamedayData; builtAt: number }
```

A review found the single slot was a hole, so it became a `Map` keyed by `season:week`,
installed with the idiom already used elsewhere in the file:

```ts
const store = (globalForGameday.snapCountGameday ??= new Map());
```

Every subsequent request then failed with `TypeError: store.get is not a function`.

## Decision / Finding

**`??=` assigns only when the left side is null or undefined.** The *old* object was
still sitting on `globalThis` and was perfectly truthy, so the new `Map` was never
installed — and every call went on to invoke `Map` methods against an object literal.

The first instinct was to write this off as a hot-reload artifact of `next dev`. That is
wrong, and the distinction matters: **a warm serverless instance surviving a deploy fails
in exactly the same way.** Vercel reuses instances across deployments, so any release that
changes the shape of something cached on `globalThis` can find the previous shape already
there. In production this would have been every request on some instances and none on
others, which is the worst version of the bug to diagnose.

**Fix:** verify the shape, never merely its presence.

```ts
const existing = globalForGameday.snapCountGameday;
const store = existing instanceof Map ? existing : (globalForGameday.snapCountGameday = new Map());
```

## Rationale

Why not version the key instead (`snapCountGameday_v2`)? It works, but it leaks the old
value forever on a long-lived instance and needs discipline at every future change. An
`instanceof` check is self-correcting: it costs one comparison and cannot be forgotten in
a way that fails silently.

Root cause is subtler than the patch. The mental model behind `??=` here was
"initialise once per process" — but the lifetime of `globalThis` is *the instance*, not
*the deploy*, and those diverge precisely when code changes. Anything memoised there is
implicitly a persisted format, and persisted formats need shape checks the same way
database rows do.

## Impact

- Applies to all four `globalThis` caches in this codebase: the poll memo, its in-flight
  map, the drill-in memo, and the rate limiter's bucket map. All now shape-check.
- The precedent caches in `src/lib/data/live.ts` (byes, projections) hold plain objects
  and are read field-by-field, so they degrade rather than throw — but the same hazard
  applies if their shape ever changes.
- Generalises beyond this repo: **any process-global cache in a serverless runtime is a
  cross-deploy format.** Treat a shape change there like a schema migration.

## Action Items

- [x] Shape checks added to every `globalThis` cache in the gameday path
- [x] Covered by a unit test — "survives a wrong-shaped value left on globalThis"
- [ ] Apply the same check to `live.ts`'s caches next time they are touched

## References

- `src/lib/data/gameday.ts`, `src/lib/data/gameday-detail.ts`, `src/lib/rate-limit.ts`
- `src/lib/rate-limit.test.ts` — the regression test
- `docs/reviews/2026-09-04-review-live-gameday.md` — Resolution section
