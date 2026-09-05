---
review: uncommitted changes — the complete Live Gameday feature (16 units)
status: warnings
date: 2026-09-04
scope: uncommitted
files-reviewed: 38
agents: knowledge-researcher, security-reviewer, architecture-reviewer, frontend-reviewer
deploy-blockers: 0
critical-issues: 6
critical-resolved: 6
warnings: 14
warnings-resolved: 9
---

# Code Review: Live Gameday (uncommitted)

## Resolution (2026-09-04, same session)

**All six critical findings fixed and verified.** Of the fourteen warnings, **nine are
closed**: W1 (unencoded season in credentialed URLs), W2 (error leakage on all three
routes), W3 (unbounded timeline read), W4 (`RosterPresence` renamed to `PresenceIndex`
on the component side), W10 (`useCallback` + `React.memo` on the heavy panels), W11
(drill-in moved after the wall in DOM order, wired with `aria-controls`), W12 (`role="img"`
on the labelled dots), W13 (route error boundary), W14 (`AbortController`). The five
design observations are also addressed — memoised filters and sorts, a loaded-but-empty
state in the drill-in, and the red-zone border now gated on `redZoneForMe` so it matches
what its own comment claims.

**Five warnings remain open, all architectural**: W5 (model math in the data layer), W6
(timeline route doing loader work), W7 (drill-in loader has no last-known-good fallback),
W8 (two query paths for "mine / against"), W9 (the domain module serving two audiences).
These are refactors rather than defects — none changes behaviour — and are better done as
one deliberate pass than folded into a review fix.

Verified behaviour after the fixes, measured rather than assumed:

| Finding | Before | After |
|---|---|---|
| C1 alternating `?week=` | full rebuild per request | 0ms, both served from memo |
| C1 concurrent misses | one fan-out each | one build, all callers got the identical object |
| C1 memo growth | single slot, thrashed | capped at 4 entries after 9 distinct weeks |
| C2 NFL state | Sleeper call on every request | memoised, 5-minute TTL |
| C3 event ids | any digit string, cached forever | `1` and a 40-digit id both 400; map capped at 20 |
| C6 non-JSON error | `Unexpected token '<'` | route's `{ error }` surfaces correctly |

Two things surfaced *while* fixing, both now closed:

- A `globalThis` **shape migration hazard**. Replacing the single-slot memo with a `Map`
  left the old object in `globalThis`, and `??=` preserved it because it was truthy —
  every request then died on `store.get is not a function`. This is not merely a
  hot-reload artifact: a warm serverless instance surviving a deploy that changes a memo's
  shape fails identically. Both memos now `instanceof Map` check before use.
- A **regex mangled by shell escaping** during the fix: `/^\d{6,12}$/` was written as
  `/^d{6,12}$/`, which matches the letter "d" and would have rejected every real event id.
  Caught by reading the written file rather than trusting the edit.

## Summary

| Agent | Status | Critical | Warnings |
|-------|--------|----------|----------|
| Security | Warnings | 3 | 3 |
| Architecture | Warnings | 1 | 5 |
| Frontend | Warnings | 2 | 6 |
| Backend | Skipped — no `.cs` files | — | — |
| Observability | Skipped — no `.cs` / `appsettings*.json` | — | — |
| Impeccable Audit / Critique | Not run — `/impeccable:audit` is not a registered command in this install (only the `impeccable` skill is) | — | — |

**No deploy blockers.** No hardcoded secrets, no SQL injection, no XSS, no credential leakage into any
client payload. The issues below are real but none of them prevents shipping.

---

## 🚫 Deploy Blockers

None.

---

## Critical Issues (Must Fix)

### C1. The poll memo does not bound fan-out — single slot, keyed on caller-controlled input
`src/lib/data/gameday.ts:85-87, 150-163`

`globalForGameday.snapCountGameday` holds **one** entry keyed `${season}:${week}`. `week` accepts 18
values and `season` is taken verbatim from `?season=` and is **not validated at all** (unlike `week`).
Alternating `?week=1` and `?week=2` yields a 0% hit rate: every request runs the full `build()` —
~10 upstream calls plus 5 database queries.

The memo was designed to collapse concurrent tabs, and it does that. It does not bound a hostile or
careless caller, which is what the plan's stated abuse-case mitigation claims it does.

**Fix:** validate or ignore `season` (nothing renders it as a selector today); replace the single slot
with a small bounded LRU (~4 entries); and store the in-flight `Promise` rather than the resolved value
so N concurrent misses on one key produce one fan-out.

### C2. Every request hits Sleeper upstream even on a memo hit
`src/lib/data/gameday.ts:144`

`await sleeper.getState()` runs **before** the memo check, to resolve season and week. Because
`dynamic = "force-dynamic"` sets `fetchCache = "force-no-store"` for the segment, that client's
`revalidate: 300` is overridden and the call is genuinely uncached. So the memo is not on the path of
every upstream call — a "cache hit" still costs one Sleeper round-trip.

**Fix:** give `getState()` its own `globalThis` TTL memo (5 minutes is ample — it changes weekly), or
resolve season/week from already-cached state before the memo lookup.

### C3. Unbounded per-event memo in the drill-in loader
`src/lib/data/gameday-detail.ts:33-35, 208`

`store.set(eventId, …)` with no eviction and no cap. `/^\d+$/` permits arbitrarily long ids, so the key
space is effectively infinite; growth is bounded only by whether ESPN 404s bogus ids, which is an
upstream's error behaviour rather than a control of ours.

**Fix:** evict expired entries on write and cap the map (~32). Better still, validate `eventId` against
the event ids on the current scoreboard — an id that is not on this week's slate is not a real request.

### C4. `PlayEvent` is declared twice
`src/lib/domain/gameday.ts:271` and `src/lib/platforms/nfl/gamefeed.ts:328`

Two independent, structurally identical declarations. `gamefeed.ts` already imports seven other types
from the domain module and simply missed this one, so `normalizePlays`/`fetchPlayFeed` return the
platform copy and satisfy `GameDetail.plays` only by structural luck. One edit to either drifts
silently, and the compiler will not say so.

**Fix:** delete the copy in `gamefeed.ts` and add `PlayEvent` to its existing domain import block.

### C5. A 1 Hz clock re-renders the entire page every second
`src/hooks/useGamedayPoll.ts:106-109`, consumed at `src/components/gameday/GamedayShell.tsx:30`

`setNow` lives in the hook, so each tick re-renders `GamedayShell` and reconciles the rooting bar, all
nine matchup cards (including any expanded standings tables), the whole game wall, and the drill-in with
its two Recharts trees and box-score tables — purely to advance an "updated Xs ago" label. That is
roughly 60× more render work per minute than the 25-second poll it decorates, and it keeps running while
the tab is hidden, undoing the battery saving the hook was built for.

**Fix:** return `generatedAt` from the hook, delete the `now` state, and move the interval into a leaf
`<DataAge />` component in the header so only that node ticks. Gate the tick on
`document.visibilityState === "visible"`.

### C6. A non-JSON error response surfaces as a JSON parse error
`src/components/gameday/GameDrillIn.tsx:51-53`, `src/components/gameday/DayTimeline.tsx:63-65`

`await res.json()` runs **before** the `res.ok` check, so a 500 returning an HTML error page shows the
user `Unexpected token '<'` instead of the route's `{ error }` payload or the status code. Notably
`src/hooks/useGamedayPoll.ts:70` already does this correctly — the three files disagree with each other.

**Fix:** `const body = (await res.json().catch(() => null)) as { error?: string } | null;` then check
`res.ok`. This also removes the implicit `any` currently leaking into `body?.error`.

---

## Warnings (Should Fix)

### Security
- **W1. Unencoded `season` interpolated into a *credentialed* ESPN URL** —
  `src/lib/platforms/espn/client.ts:212` (also `:144`, `:151`). Reached from `gameday.ts` via
  `readEspnLiveWeek` with the raw query param. Exploitation is currently blocked only *incidentally*:
  an injected value matches no league row and `build()` returns early. That is a data-shape accident,
  not a control. Path-only manipulation on a fixed host, so not full SSRF. Fix: `encodeURIComponent`,
  matching `scoreboard.ts:277` which already does it correctly.
- **W2. Raw error messages returned to unauthenticated callers** — `api/gameday/route.ts:69`,
  `game/[eventId]/route.ts:44`, `timeline/route.ts:67`. Postgres/undici errors leak internal hostnames
  and driver detail. Fix: fixed string to the client, `console.error` the original.
- **W3. `/api/gameday/timeline` reads a whole week of snapshots unbounded** —
  `gameday-snapshot.ts:139-145`, no `LIMIT` and no time bound. Fix: `.limit(1000)` plus an optional
  `since`.

### Architecture
- **W4. `RosterPresence` declared twice with different shapes** — `domain/gameday.ts:339` uses `Record`
  (deliberately, since a `Map` serialises to `{}`); `components/gameday/GameWall.tsx:25` redeclares it
  with `Map`. The shell converts correctly so this is not a live bug, but two same-named
  differently-shaped types is how one becomes a bug. Fix: rename the component-side one `PresenceIndex`.
- **W5. Model math has leaked into the data layer** — `data/gameday.ts` `build()` is ~460 lines and
  carries per-rival survival leverage (`:497-514`), `countByGame`, `withRootFor`, and the
  `ALERT_STATUSES` classification. Those are domain rules. Fix: export them from `domain/rooting.ts` and
  leave `build()` as fetch → join → call.
- **W6. `/api/gameday/timeline/route.ts` is not thin** — it resolves season/week via `sleeper.getState()`
  (the only route importing a platform client) and pivots snapshots into chart rows. Fix: move to
  `loadTimeline()` in `data/gameday-snapshot.ts`.
- **W7. `gameday-detail.ts` diverges from the error contract** — no last-known-good fallback, so any
  throw from its four DB queries becomes a 500 even though `GameDetail.warnings` exists for exactly
  this. The `getProTeams` call *is* correctly guarded; the DB path is not.
- **W8. Two query paths for "mine / against"** — `gameday.ts:552-608` and `gameday-detail.ts:57-134`
  query the same four tables for the same question and project differently. They already disagree on
  alias loading (one loads aliases only when ESPN credentials exist, the other always). Fix: one
  `loadRosterStake(season, week)` plus two pure projections. Removes ~70 duplicated lines.
- **W9. `domain/gameday.ts` serves two audiences** (375 lines) — the poll payload and the drill-in,
  which share only three types and have disjoint consumers. Fix: split the drill-in types into their own
  module. Do it with C4.

### Frontend
- **W10. Inline arrow callbacks prevent memoising the heavy children** — `GamedayShell.tsx:158,164`;
  `refresh` also returns a fresh closure each render (`useGamedayPoll.ts:114`). Fix: `useCallback`,
  return `refresh: poll`, then `React.memo` `GameWall` and `MatchupRail`.
- **W11. The drill-in renders *before* the game wall in DOM order** — a keyboard or screen-reader user
  activates a card and the new panel is upstream of focus: tabbing forward never reaches it, and nothing
  is announced. Fix: render it after the wall, or move focus to it and wire `aria-controls`.
- **W12. `aria-label` on a role-less `<span>` is dropped by most screen readers** — the possession dot
  (`GameWall.tsx:250`) and the live dot (`RootingBar.tsx:174`) are silent. Fix: add `role="img"`.
- **W13. No error boundary on the route** — a throw inside Recharts replaces the live screen with Next's
  error page. Fix: add `src/app/gameday/error.tsx`.
- **W14. No `AbortController` in the drill-in fetch** — the `cancelled` flag stops the `setState` but a
  ~595KB body keeps downloading after close; rapid card-switching stacks these on a phone.

---

## Design Observations (advisory)

- `GameDrillIn.tsx:143,153` filters `plays` twice per render and re-maps the win-probability series;
  `GuillotineWatch.tsx:23` copies and sorts standings every render. All cheap to `useMemo`.
- `GameDrillIn` has no "loaded but empty" state — a pre-kickoff game renders a header and nothing else.
- Information exposed only through `title=` (`RootingBar.tsx:161`, `PreKickoff.tsx:113`,
  `GameWall.tsx:227`) is unreachable by keyboard and touch. The rooting tile's per-league breakdown is
  load-bearing enough to deserve a real affordance.
- `GameWall.tsx:151` paints a red border for *any* red zone, which is the "lights up a third of the
  slate" noise the comment at `:122` says the design avoids — only the *pulse* is gated on
  `redZoneForMe`.
- Reduced-motion specificity: `.sc-pulse { border-color: var(--sc-red) }` is a normal author declaration
  and loses to the inline `borderColor`. It happens to match today, but an *open* red-zone card resolves
  to `--sc-accent` and silently drops the red-zone signal under reduced motion, while the animated path
  keeps it.

---

## Known Pattern Matches

None. This repo has no `docs/decisions/`, so there is no local knowledge base to match against — the
plan file's own adversarial-review section was the only prior art. Running `/impact-dev:learn` after
this build would give the next feature something to match against; the Next 16
`force-dynamic`-defeats-`revalidate` trap and the stale-while-revalidate reasoning are both worth
recording.

---

## Passed Checks

**Security (verified, not assumed):**
- No credential leakage. `espnCredentials()` is a boolean gate in the gameday path; nothing derived from
  `ESPN_S2` or the SWID reaches `GamedayData`, `GameDetail`, or the timeline response. `league.settings`
  is reduced to a `LeagueFormat` label and never serialised.
- Snapshot `payload` jsonb carries ids, names, scores and NFL game state only — no credentials, no PII.
- SQL injection clean: every new query uses the Drizzle builder with parameterised `eq`/`and`/`inArray`.
  The one `sql` template is `count(*)::int` with zero interpolation.
- The `gameday_snapshots_bucket_uq (season, week, bucket)` index exactly matches the
  `onConflictDoNothing` target, and `bucket` is quantised before insert — the dedupe genuinely works.
- `eventId` validation is anchored and checked at both the trust boundary and defensively at both
  fetchers. No newline or `?`/`#` truncation. Only the length bound is missing (C3).
- `week` validation correct in all three routes. `/api/sync` remains `SYNC_SECRET`-gated.
- No `dangerouslySetInnerHTML` anywhere. ESPN play text renders as React text nodes.
- No second-order SSRF: `$ref` parsing uses anchored digit captures and no upstream value builds a
  subsequent request URL.

**Architecture:**
- `domain/` is pure — `rooting.ts` has no `fetch`, no `Date`, no database import.
- `platforms/` never touches the database; roster context is injected as a parameter.
- **No circular import.** `sync.ts → gameday.ts → sync-espn.ts` is a DAG: `sync-espn.ts` imports nothing
  from `data/`. Verified by grep, not assumed.
- The memo idiom, warning accumulation and error degradation match `live.ts` precedent.

**Frontend:**
- **The poll loop is sound.** Interval keys on `data.anyLive` with a stable `poll`; cleanup clears the
  id; `inFlight` prevents overlap without re-arming the timer; the `visibilitychange` listener is
  symmetrically added and removed. No leak, no double-arming, no runaway timer.
- The `useEffect` + `cancelled` + `key={eventId}` remount pattern is correct for Next 16 here; `use()`
  would re-fire every render without a cached promise.
- `role="button"` + `tabIndex={0}` + Enter/Space with `preventDefault` implemented correctly, no nested
  interactives. `aria-expanded` on real buttons, `aria-pressed` on toggles, `role="img"` + percentage
  label on the win-probability bar, 44px minimums throughout.
- `@keyframes sc-pulse` is disabled under `prefers-reduced-motion` alongside `.spin`.

---

## Scope

Reviewed: uncommitted changes — 38 files (29 TS/TSX, 9 config/SQL/docs), excluding `package-lock.json`.

`/review` is diff-scoped and advisory: no build, no full test suite, no dependency CVE scan, no
environment or repo-hygiene audit. **`/impact-dev:pre-deploy` is the canonical pre-ship gate** and has
not been run.
