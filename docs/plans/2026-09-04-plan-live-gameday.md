---
feature: Live Gameday experience
status: planned
date: 2026-09-04
depth: deep
builder: Product Owner + AI
complexity: Very High
confidence: Medium-High (two High-risk decisions rewritten by adversarial review; two items unverifiable until a live game)
deepened: 2026-09-04
session: c209bf10-ce55-4ef6-a723-e9fe36a722df
research-agents: codebase-analyzer, ui-pattern-researcher, docs-researcher, adversarial-reviewer (doubt-driven)
---

# Plan: Live Gameday Experience

## Summary

A new full-bleed `/gameday` route that is worth opening at noon on an NFL Sunday. It shows
live NFL game state and live fantasy scoring across all 9 leagues at once, tells the user
which games to root for, lets them drill into a single game for box score and play-by-play,
and records the day so it can be replayed afterwards.

**Hard deadline, verified against ESPN's schedule feed:** NFL 2026 Week 1 opens Wed Sep 9
7:20 PM CT (1 game), then Sun Sep 13 12:00 PM CT (8 simultaneous games), 3:25 PM CT (4
games), SNF 7:20 PM CT, MNF Mon Sep 14.

**The Sep 9 opener is a live-fire rehearsal and the plan is built around it.** Several
assumptions below (ESPN's `situation` object, live `mMatchup` behaviour, Sleeper's
`players_points` update cadence) are *unverifiable against a completed game* — they only
populate while a game is in progress. Units 1-7 must be usable by Sep 9 so they can be
watched against real moving data four days before it counts.

### Scope

Core: live matchup races for all 9 leagues with league-wide scores collapsed underneath;
the rooting-interest engine (the hero); an NFL game wall with drill-in; a cross-league
annotated play feed.

Supporting: red-zone radar; Guillotine watch; TV-window grouping; a useful pre-kickoff
state; live bench regret; the day timeline.

Explicitly out of scope by the user's decision: **sound/haptics, web push notifications,
and any Claude/LLM involvement.** Gameday stays fast, free and deterministic.

---

## Research Findings

### Measured feed characteristics (probed 2026-09-04 against real payloads)

| Feed | Size | Latency | Contents |
|---|---|---|---|
| ESPN scoreboard — all 16 games, one call | 111-135KB | 130-320ms | score, clock, period, down/distance, possession, `isRedZone`, last play, linescores, records, TV |
| ESPN summary — per game | 595KB | ~160ms | box score by category, drives, `scoringPlays`, win probability (186 points), leaders, injuries, odds |
| ESPN core plays — per game | 826KB / 193 plays | ~390ms | full play-by-play **with `participants[]` carrying athlete IDs** |
| Sleeper matchups — per league | small | fast | `players_points`, the same numbers Sleeper's own app shows |
| Sleeper stats — all players | 568KB | 75ms | raw stat lines, 2,332 players |

One cheap call covers every game; the expensive per-game calls are only needed for a
drill-in. That asymmetry dictates the two-tier polling design.

### Verified data foundation (do not re-research)

- `roster_slots` holds starters for **all** teams in **all** leagues — 1,005 starter slots.
  Kinds are `starter | bench | ir | taxi`. Opponent lineups are therefore available.
- `matchups.opponent_team_id` is populated for week 1 in every league **except Guillotine
  Season 5** (18 rows, 0 opponents) — it is a survival format with no head-to-head.
- `player_projections` covers 262 of 274 distinct week-1 starters (96%). The 12 without a
  projection need a documented fallback (position average), not a silent zero.
- `players.nfl_team` is the join key to ESPN scoreboard competitors. `normalizeEspnAbbr()`
  in `src/lib/platforms/nfl/schedule.ts` already resolves the WSH/WAS disagreement and
  **must be reused** — keyed on ESPN's spelling, a team's players fail to join at all.
- **ESPN's site/core API athlete IDs share the fantasy API's ID space.** Verified: five IDs
  pulled from a real play-by-play payload (Josh Jacobs 4047365, Jayden Daniels 4426348,
  Lamar Jackson 3916387, Jahmyr Gibbs 4429795, Bijan Robinson 4430807) all resolved through
  the existing 9,045-row `player_aliases` crosswalk built by `syncEspnAliases`. The play
  feed can join on IDs, not names.
- The user's 75 starter slots span **31 of 32 NFL teams**; week-1 opponents' 67 starters
  span 29. Nearly every game contains both sides' players — which is precisely why a naive
  "net projected points" label reads as "mixed" for all 13 games and conveys nothing. This
  is the entire justification for leverage weighting.

### Codebase patterns found

- `src/lib/domain/types.ts` is one flat file of per-view slice interfaces composed into a
  thin `DashboardData` envelope (`state`, `viewedWeek`, `teams`, `lastSyncedAt`, `source`,
  `warnings`). Every field carries a comment explaining why it is shaped or nullable that
  way. `GamedayData` must mirror this and reuse `Platform` / `NflStateView`.
- `dashboard.ts` is the cache-aside orchestrator; `live.ts` fetches straight from Sleeper
  with no DB; `repo.ts` reads only Postgres and returns `null` so the caller can fall back.
- **`live.ts` already establishes the in-process memo idiom** this feature needs:
  `globalThis`-attached caches with a TTL, keyed by season/week, falling back to
  last-known-good on fetch failure (byes 24h at lines 34-55, projections 15min at 63-108).
- **`Dashboard.tsx` has no polling of any kind** — refresh is a manual button using
  `useTransition` + `fetch("/api/dashboard", { cache: "no-store" })`. No interval, no
  `visibilitychange`, no SWR or React Query. The gameday poll loop is genuinely new.
- `Dashboard.tsx` is `"use client"` and always renders header + sidebar + content with no
  shell-less mode, so `/gameday` must be a separate route, not a tab.
- Route handler conventions (`api/dashboard/route.ts`): `export const dynamic =
  "force-dynamic"`, raw domain object on success with `cache-control: no-store`,
  `{ error: string }` with 400/500 on failure.
- `MatchupView.tsx` is built entirely around season-long roster/lineup data with no
  live-game concept. Not reusable; its presentational primitives are.
- Schema conventions: `pgTable("snake_case", {...}, (t) => [...])`, a shared `timestamps`
  spread — but append-only tables (`syncRuns`, `matchupPlayers`, `trendingPlayers`)
  deliberately use a single timestamp instead. `numeric({precision:10,scale:2})` for point
  totals, `real()` for finer per-player values, `jsonb()` for passthrough payloads.

### UI pattern brief

- **Tokens** (`globals.css` `:root`): surfaces `--sc-bg:#10151a`, `--sc-surface:#161c22`,
  `--sc-surface-raised:#1d242b`, `--sc-border:#2a323b`; text `--sc-text:#f5f3ee`,
  `--sc-text-muted:#8b95a1`; accents `--sc-accent:#f2a63d` (plus `-soft`/`-border`),
  `--sc-green:#4c9a5b`, `--sc-red:#d9534f`, `--sc-orange:#e2725b`, `--sc-cyan:#6ec6ca`,
  `--sc-purple:#9b7bd9`; `--sc-radius:10px` is the **only** radius token; fonts
  `--sc-font-display` (Oswald), `--sc-font-body` (Inter), `--sc-font-mono` (IBM Plex Mono).
- **No shadow tokens exist** — elevation is a border-colour change plus `translateY(-1px)`,
  never `box-shadow`. There is no spacing scale; spacing is ad hoc pixel values inline.
- **Deliberate style split**, documented in the `globals.css` header: only layout that must
  change under a media query goes into a CSS class (because inline styles outrank any
  selector short of `!important`); everything cosmetic stays inline `style={{}}`. A general
  "never use inline styles" rule does **not** apply to this repo — follow the local split.
- Reusable: `.sc-card` (plus `.sc-hover`), `.sc-mono` for all numerics, `.sc-label`,
  `.sc-section-title`, `table.sc-table`, `.sc-grid-teams` (auto-fit grid, naturally
  responsive), and **`.sc-versus` / `.sc-versus-divider`** — the `1fr auto 1fr` two-sided
  comparison that collapses to one column under 720px. That is the matchup-card pattern.
- Primitives: `PlatformBadge`, `FormatBadge`, `PosTag`, `Pill`, `StatusTag`,
  `ConsistencyTag`, `MetricCard`, `EmptyState`, `Loading`, `Avatar`, and `fmt(n, digits=1)`
  which renders `"—"` for null/NaN. **`"—"` is the house dash-for-missing convention — not
  `0`, not blank.**
- Responsive: a single `@media (max-width: 720px)` breakpoint, no JS breakpoint checks.
- Live affordances: `.spin` plus `@keyframes sc-spin` is the *only* animation, and it is
  disabled under `prefers-reduced-motion`. There is no pulse, no skeleton, and no
  "updated Xs ago" — all new work.
- **Drift to avoid:** inline-plus-`!important` mobile overrides (`.sc-scoreboard-tile`) are
  an acknowledged workaround, not a template. Badge geometry is already duplicated three
  times — reuse `Pill` for status chips rather than adding a fourth variant. Status
  indicators are currently split between "pill with background" and "bare text plus icon";
  pick one deliberately for red-zone/possession rather than mixing both in one wall.

### Current documentation (Next.js 16.3.2 — bundled docs are authoritative)

- `dynamic = "force-dynamic"` **is** documented as equivalent to `{cache:'no-store',
  next:{revalidate:0}}` on every fetch plus `fetchCache='force-no-store'`, which overrides
  per-fetch options "even if they provide a `'force-cache'` option". The Route segment
  config section explicitly covers `route.ts`, so there is no route-handler exemption.
- Route handlers are **not cached by default** in 16; `force-static` is required to cache a
  GET. `cacheComponents` is not enabled here, so the Cache-Components prerender model is
  inactive.
- `cacheComponents: true` is a **whole-app** change (dynamic-by-default fetching, PPR as
  the default, `<Activity>`-based navigation preserving state across routes, Node runtime
  required). It cannot be scoped to one feature. **Decision: do not enable it.**
- `unstable_cache` still functions but is documented as replaced by `use cache`.
- The "2MB data-cache ceiling" comment in `sleeper/client.ts:205-207` refers to a Vercel
  platform limit; no such figure appears in the Next docs. Our 595KB/826KB payloads clear
  it regardless.
- Recharts 3.10.1: `ResponsiveContainer`, `LineChart`/`AreaChart`, `XAxis`/`YAxis`,
  `Tooltip`, `CartesianGrid`, `Legend`, `Line`, `Area` are all unchanged and current, and
  the existing `ChartsView.tsx` usage is v3-compatible as written. v2-memory hazards for the
  new charts: `activeIndex` was removed; multi-Y-axis ordering is now alphabetical by
  `yAxisId` rather than render order; a custom Tooltip `content` component types as
  `TooltipContentProps`, not `TooltipProps`; and `AreaChart` with `connectNulls: true` now
  renders nulls as 0 rather than skipping them — verify that is wanted for a stepped
  win-probability line.

### Adversarial review (doubt-driven) — both original decisions were BROKEN

**Original decision 1 — "omit `dynamic`, rely on per-fetch `next: {revalidate: 15}`" —
DISCARDED.** Three independent defects:

1. Default `fetchCache: 'auto'` does not cache fetches discovered *after* a request-time
   API is used. A gameday route reads `request.url`/`searchParams` first, so all ~10
   fan-out fetches fall on the uncached side. It would need an explicit
   `fetchCache = 'default-cache'` to even have a chance.
2. `src/lib/platforms/espn/client.ts:89-92` hardcodes `cache: "no-store"` on every ESPN
   fetch, so ESPN calls can never populate the Data Cache regardless of route config.
   Sleeper's `fetchJson` defaults `revalidate = 0` and would need a new threaded option.
3. **Disqualifying:** the Data Cache is stale-while-revalidate. The first poll past 15s
   serves *stale* scores and refreshes in the background, so live scores could lag up to two
   windows. Stale is the one thing a live scoreboard must never be. It would also persist
   ESPN-cookie-bearing private-league responses into a shared regional cache, since the
   cache key includes the `cookie` header.

**Revised decision 1: keep `export const dynamic = "force-dynamic"`** (matching
`api/dashboard/route.ts` and `api/sync/route.ts` rather than deviating from local
convention) **and collapse polls in-process** with a module-level/`globalThis` memo keyed by
`(season, week)` with a ~15s TTL — the exact idiom `live.ts` already uses and
`sleeper/client.ts:206-207` already documents. Fresh rather than stale, bounded per
instance, and no shared store holding credential-bearing responses.

**Original decision 2 — "write a snapshot row from inside the gameday GET when the cache
refreshes" — DISCARDED.** A `fetch` Data Cache hit is *undetectable* from application code
(`fetch` resolves identically on hit and miss), so "write when the cache refreshes" is
unimplementable. The handler body runs on every request regardless, so the write would fire
per poll: N tabs times 3 polls/min equals N non-idempotent rows per interval with no dedupe
key. A mutating GET also breaks HTTP semantics for any future CDN or prefetch. And
`src/lib/db/client.ts:29-34` sets `max: 10` **per instance**, which multiplies against
Supabase's pooler limit as Vercel scales instances horizontally under concurrent polling.
Finally the timeline would only be sampled while a tab was open — an x-axis of "when someone
looked", with unfillable gaps across pregame and between windows, never backfillable.

**Revised decision 2: the snapshot write moves into `/api/sync?scope=live`**, driven by the
game-day crons already present in `.github/workflows/sync.yml:34-38` (`*/10` across the NFL
windows; tighten to `*/5` if 10 minutes is too coarse). One authenticated writer, a fixed
cadence, dedupable via a unique index on `(season, week, bucket)`. `/api/gameday` becomes a
pure read.

**Both fixes converge on one architecture: live scores are passthrough because freshness
matters; history comes from cron-written snapshots because coverage matters.**

---

## Confidence Assessment

| Section | Confidence | Risk if Wrong | Notes |
|---|---|---|---|
| Domain types | High | Low | Mirrors the `DashboardData` envelope exactly |
| ESPN scoreboard client | High | Low | Measured endpoint; sibling of `schedule.ts`; reuses `normalizeEspnAbbr` |
| — its live `situation` subset | **Medium** | Medium | Only populates during a live game. **Unverifiable until Sep 9.** |
| Rooting math | **Medium** | **High — wrong labels fail silently** | Pure and unit-testable, but the variance model has no ground truth. Mitigated by design, not research: the raw-points toggle as an escape hatch, honest in-UI labelling, hand-computed unit tests. |
| Route caching / poll collapse | High *(was Medium)* | High | Raised by the adversarial pass: the in-process memo is proven in-repo and does not depend on Data Cache semantics |
| Snapshot design | High *(was Medium)* | Medium | Raised by the adversarial pass — but **blocked on a prerequisite**, see Risks |
| ESPN live scoring | **Medium** | **High — 2 of 9 leagues freeze** | `mMatchup` plus `scoringPeriodId` proven for completed weeks; live behaviour **unverifiable until Sep 9** |
| Cross-league play feed | High | Low | Athlete-ID join verified end-to-end against a real payload and the crosswalk |
| Frontend components | High | Low | Concrete pattern brief; single breakpoint; primitives inventoried |
| Auth and security | High | Medium | No auth exists in this app; the real exposure is poll amplification — see Abuse case |
| Test plan | **Medium** | Medium | **No test framework exists at all.** Adding Vitest is a new-dependency decision. |

Two Medium ratings (`situation`, live ESPN scoring) are **not resolvable by more research** —
they need a live game. That is the whole reason the Sep 9 checkpoint exists rather than
building straight through to Sep 13.

---

## Past Decisions Referenced

None — this repo has no `docs/decisions/`. It is a personal project outside the ADO org, so
`knowledge-researcher` was deliberately not spawned. **Recommend running `/impact-dev:learn`
after this build** to capture at minimum: the Next 16 `force-dynamic`-defeats-revalidate
trap, the stale-while-revalidate reason live data must not use the Data Cache, and the ESPN
mock-league `CUSTOM_MOCK` discriminator.

---

## Files to Create or Modify

### Create

- `src/lib/domain/gameday.ts` — `GamedayData` envelope plus slice types
- `src/lib/domain/rooting.ts` — pure math: win probability, leverage, rooting interest, Guillotine survival
- `src/lib/platforms/nfl/scoreboard.ts` — ESPN public scoreboard client and normalizer
- `src/lib/platforms/nfl/gamefeed.ts` — per-game summary and core plays, athlete-ID extraction
- `src/lib/data/gameday.ts` — orchestrator with the in-process memo
- `src/lib/data/gameday-snapshot.ts` — snapshot write (called by sync) and timeline read
- `src/app/api/gameday/route.ts` — poll endpoint
- `src/app/api/gameday/game/[eventId]/route.ts` — drill-in endpoint
- `src/app/gameday/page.tsx` and `src/app/gameday/layout.tsx` — full-bleed route
- `src/components/gameday/` — `GamedayShell`, `RootingBar`, `MatchupRail`, `LiveMatchupCard`,
  `GameWall`, `GameCard`, `GameStatusChip`, `PlayFeed`, `GameDrillIn`, `GuillotineWatch`,
  `WindowStrip`, `PreKickoff`, `DayTimeline`
- `src/hooks/useGamedayPoll.ts` — interval plus visibility-aware polling
- `drizzle/` — migration for `gameday_snapshots`
- `vitest.config.ts`, `src/lib/domain/rooting.test.ts`, and fixture payloads under
  `src/lib/platforms/nfl/__fixtures__/`

### Modify

- `src/lib/db/schema.ts` — add `gamedaySnapshots`
- `src/lib/platforms/sleeper/client.ts` — allow a per-call `revalidate` override on
  `getMatchups` (currently hardcoded to 120s, far too stale for gameday)
- `src/lib/data/sync-espn.ts` — extract a reusable live-week ESPN reader from the week loop
- `src/lib/data/sync.ts` — ESPN live scoring in `syncLiveScores`; call the snapshot writer
- `src/app/api/sync/route.ts` — no signature change expected; verify `scope=live` still
  returns within `maxDuration`
- `src/components/Dashboard.tsx` — link or banner to `/gameday` when games are live
- `package.json` — Vitest plus a `test` script
- `.github/workflows/ci.yml` — add a test step
- `.github/workflows/sync.yml` — consider `*/5` during NFL windows for timeline granularity

---

## Implementation Order

- [ ] 1. Domain types — `src/lib/domain/gameday.ts`, mirroring the `DashboardData` envelope
- [ ] 2. ESPN scoreboard client — `src/lib/platforms/nfl/scoreboard.ts`, all games in one call, reusing `normalizeEspnAbbr`
- [ ] 3. Rooting math plus Vitest — `src/lib/domain/rooting.ts` as pure functions with hand-computed tests
- [ ] 4. ESPN live scoring — **prerequisite**; extract the live-week reader and wire it into `syncLiveScores`
- [ ] 5. Gameday orchestrator — `src/lib/data/gameday.ts`, fan-out plus roster join plus in-process memo
- [ ] 6. Poll endpoint — `src/app/api/gameday/route.ts`, `force-dynamic`, pure read
- [ ] 7. Poll hook plus full-bleed shell — `useGamedayPoll` and the `/gameday` route rendering live scores and rooting order — **SEP 9 REHEARSAL CHECKPOINT: units 1-7 must be watchable against the live opener**
- [ ] 8. Matchup rail — nine races with win probability, points-to-come, yet-to-play, league-wide scores collapsed
- [ ] 9. Rooting bar — leverage-weighted default with the raw-points toggle
- [ ] 10. Game wall — game cards, status chips, possession, red-zone radar cross-referenced to rosters
- [ ] 11. Snapshots — `gameday_snapshots` table, writer called from `scope=live`, cron cadence
- [ ] 12. Game drill-in — box score with the user's players highlighted, drive chart, win-probability chart, play-by-play
- [ ] 13. Cross-league play feed — athlete-ID join, per-league help/hurt annotation
- [ ] 14. Guillotine watch — inverted survival math, its own component
- [ ] 15. Pre-kickoff state plus TV windows — useful at 11:55, inactives and questionables across all 9 leagues
- [ ] 16. Day timeline plus bench regret — Recharts timeline from snapshots, live optimal-lineup delta

---

## Detailed Steps

### Data Layer

**`gameday_snapshots`** — append-only, following the `syncRuns` shape rather than the full
`timestamps` spread:

- `id` uuid primary key, default random
- `season` text not null, `week` integer not null
- `bucket` timestamp with time zone not null — the *quantised* sample time (floor to the
  cron cadence), which is what makes the row dedupable
- `capturedAt` timestamp with time zone not null, default now
- `payload` jsonb not null — one compact object holding every league/team score plus NFL
  game state, so the timeline can annotate its own spikes with the play that caused them
- `uniqueIndex("gameday_snapshots_bucket_uq").on(season, week, bucket)` — the dedupe key
- `index("gameday_snapshots_captured_idx").on(capturedAt)` — for "most recent" reads

The write path uses `onConflictDoNothing` against the unique index, so a double-fired cron
or a retried workflow cannot duplicate a sample.

**Reads** reuse existing tables only: `roster_slots` (starters for every team), `matchups`
(opponents), `player_projections` (remaining points), `players` (`nfl_team`, `position`,
`status`), `player_aliases` (ESPN athlete-ID crosswalk), and `teams.is_mine`.

### Service Layer

**`src/lib/data/gameday.ts`** — the single entry point, mirroring `dashboard.ts`'s role:

1. Read the roster/matchup/projection context from Postgres in one wide query set, as
   `repo.ts` does deliberately rather than N+1.
2. Fan out concurrently with `Promise.all`, each call in its own try/catch pushing to
   `warnings[]` and returning `null` rather than aborting the load — the `live.ts` idiom:
   one scoreboard call, seven Sleeper `getMatchups` (with the revalidate override), two ESPN
   live-week calls.
3. Join players to games via `nfl_team` against scoreboard competitor abbreviations.
4. Compute through `src/lib/domain/rooting.ts`.
5. Wrap the whole thing in a `globalThis` memo keyed by `(season, week)` with a ~15s TTL and
   last-known-good fallback, so concurrent polls on a warm instance collapse to one fan-out.

**`src/lib/domain/rooting.ts`** — pure, no I/O, fully unit-tested:

- `remainingProjection(starters, projections)` — sum for players yet to play, with a
  documented position-average fallback for the ~4% of starters lacking a projection.
- `winProbability(myScore, myRemaining, oppScore, oppRemaining, variance)` — normal
  approximation via the normal CDF.
- `leverage(...)` — the derivative of win probability at the current score; this is what
  makes a league won by 40 contribute ~0 while a two-point game dominates.
- `rootingInterest(games, leagues, mode)` — per NFL game, summed across all 9 leagues, in
  both `"leverage"` and `"raw"` modes.
- `guillotineSurvival(myScore, myRemaining, fieldScores, variance)` — P(not lowest of 18);
  rooting interest inverts against the whole field.
- Position variance constants live here as a single named, commented table so the assumption
  sits in one auditable place rather than scattered as magic numbers.

### Presentation Layer — API

- `GET /api/gameday?week=N` — `export const dynamic = "force-dynamic"`, returns raw
  `GamedayData` with `cache-control: no-store`, `{ error }` plus 400 on a bad week, and
  `{ error }` plus 500 on failure. **Pure read — no writes.**
- `GET /api/gameday/game/[eventId]` — drill-in: summary plus core plays for one game, with
  its own ~15s in-process memo keyed by `eventId`. Validate `eventId` as digits only before
  interpolating it into an upstream URL.

### Presentation Layer — Frontend

`/gameday` is its own route with its own `layout.tsx`, deliberately outside
`Dashboard.tsx`'s header-and-sidebar shell (that component is `"use client"` and offers no
shell-less mode). Phone: sticky rooting bar, then a swipeable matchup carousel, then the game
list, with drill-in as a sheet. Desktop: three columns — matchup rail, game wall, play feed —
with drill-in expanding in place. Shared hooks, different composition.

`useGamedayPoll` is new: `setInterval` at 20-30s, a `visibilitychange` listener pausing while
hidden, back-off to ~5 minutes when no game is live, an "updated Xs ago" value, and the same
`fetch(..., { cache: "no-store" })` plus `useTransition` idiom the manual refresh already
uses.

#### Component Design

- **`GamedayShell`** — *Create new*. Precedent: the `sc-app`/`sc-body` structure in
  `Dashboard.tsx` minus header and sidebar. Full-bleed grid; three columns on desktop, one
  under 720px. Responsive layout goes in a **CSS class** (`.sc-gameday-grid`), never inline —
  per the documented `globals.css` split.
- **`RootingBar`** — *Create new*. Precedent: the `.sc-scoreboard-*` header strip in
  `Dashboard.tsx`. Sticky to the top. Each game is a compact tile: matchup short name, a mono
  net-swing figure, and a direction cue. Colour: `--sc-green` when rooting for, `--sc-red`
  when against, `--sc-text-muted` when indifferent, `--sc-accent` for the strongest interest.
  Mode toggle (leverage / raw) as an `.sc-btn` pair. Must state in-UI that leverage is a
  model, in `.sc-note` type.
- **`LiveMatchupCard`** — *Create new*, but **composed from `.sc-versus` /
  `.sc-versus-divider`**, which already gives `1fr auto 1fr` collapsing to one column at
  720px. Score in mono 22px/700 (matching `MetricCard`); projected and secondary figures in
  `--sc-cyan`; margin green/red as `MatchupView` already does; the user's side name in
  `--sc-accent`. Reuse `PlatformBadge`, `FormatBadge`, `Avatar` (`rounded="square"` for
  leagues, `"circle"` for teams) and `fmt`. Win probability as a thin bar on an
  `--sc-accent-soft` track. Collapsed league-wide rows underneath via `table.sc-table`.
- **`GameCard`** and **`GameWall`** — *Create new*. `.sc-card.sc-hover` inside a
  `.sc-grid-teams`-style `auto-fit` grid (naturally responsive, no new breakpoint).
  Clickable per the house pattern: `role="button"`, `tabIndex={0}`, an Enter/Space handler,
  and nested buttons calling `e.stopPropagation()`. Red-zone state uses a `--sc-red` border
  plus a new `@keyframes sc-pulse` following the existing `sc-spin` naming, **disabled under
  `prefers-reduced-motion`**.
- **`GameStatusChip`** — *Extend* `Pill` from `primitives.tsx` rather than adding a fourth
  badge geometry (the brief flags that duplication explicitly). One idiom for
  live/final/pregame/red-zone — do not mix the "pill with background" and "bare text plus
  icon" conventions in the same wall.
- **`PlayFeed`** — *Create new*. Vertical list, newest first, 12px body. Each row carries the
  clock, the play text truncated with `.sc-truncate`, then per-league annotation chips —
  green for helps, red for hurts. Empty state via `EmptyState`, loading via `Loading`.
- **`GameDrillIn`** — *Create new*. `.sc-split` / `.sc-split-aside` sticky-detail layout,
  which already stacks on mobile. Box score via `table.sc-table` with the user's players'
  rows tinted `--sc-accent-soft`. Win-probability and timeline charts via Recharts, matching
  `ChartsView.tsx`'s `ResponsiveContainer > LineChart` usage and its `Tooltip` `contentStyle`.
- **`GuillotineWatch`** — *Create new*. A ranked list of all 18 scores, the user's row
  highlighted in `--sc-accent`, with the elimination line drawn as a `--sc-red` border
  between rows.
- **`WindowStrip`** and **`PreKickoff`** — *Create new*. Countdown in mono. Inactives and
  questionables reuse `StatusTag` and the existing `AlertTriangle` injury idiom.
- All numerics use `.sc-mono` and `fmt`; missing values render `"—"`, never `0`. 44px
  minimum touch targets on every interactive element on phone.

### Auth and Security

No authentication exists anywhere in this app and none is being added — it is a single-user
dashboard reading public and cookie-authenticated third-party data.

**Abuse case:** `/api/gameday` is a public endpoint that turns one inbound request into ~10
upstream calls, one of them against ESPN's unauthenticated API — roughly 10x amplification
for anyone who finds the URL. The in-process memo is the mitigation that actually bounds it:
a warm instance performs at most one fan-out per 15s regardless of inbound volume, which is
strictly better than the Data Cache approach it replaced. Residual exposure is horizontal
scaling (one fan-out per instance per window). If that proves to matter, the cheapest next
step is an IP-keyed token bucket in the same memo — not auth, which would break the browser
page. The data itself is non-sensitive: public NFL scores and the user's own fantasy teams.

Two additional notes: `eventId` must be validated as digits-only before being interpolated
into an upstream URL, and ESPN credentials (`ESPN_S2` / `ESPN_SWID`) must stay server-side —
they are read via `espnCredentials()` in server code only and must never reach `GamedayData`
or any client component.

---

## Test Plan

**There is no test framework in this repo today.** CI is typecheck plus lint plus build, and
`npm run smoke` renders views against real synced data and is deliberately excluded from CI.
Adding Vitest is therefore a new-dependency decision, justified narrowly: the hero feature is
a statistical model whose errors are *silent* — a wrong win probability does not crash, it
lies confidently, which is the specific failure this app's conventions exist to avoid.
`planning-tests` sets a 90% target for pure utilities, and `rooting.ts` is exactly that.

**Unit (Vitest, `src/lib/domain/rooting.test.ts`) — the priority:**

- `winProbability` returns 0.5 for identical scores and identical remaining projections
- returns above 0.99 when the lead exceeds the opponent's total remaining projection
- returns below 0.01 in the mirrored case
- is monotonic: increasing my remaining projection never decreases my win probability
- `leverage` approaches 0 as the margin grows large in either direction, and is maximised
  near a tied projected final — the property the whole hero feature rests on
- `rootingInterest` returns 0 for a game containing none of my or my opponents' players
- correctly nets a player who helps in one league and hurts in another (the EFL/Shlong case)
- `"raw"` mode ignores leverage entirely and equals the plain point difference
- `remainingProjection` applies the position-average fallback for a starter with no
  projection row, and never silently contributes 0
- `guillotineSurvival` returns ~0 for the field's lowest score with no games left, and rises
  as the field's remaining projections rise
- hand-computed expected values for one fully worked two-league scenario, so the test
  documents the model rather than merely re-running it

**Fixture-based (Vitest) — normalizers against real captured payloads:**

- the ESPN scoreboard normalizer parses a real 16-game payload: scores, clock, period, records
- a **completed** game yields no `situation`, and the normalizer must not throw or invent one
- `normalizeEspnAbbr` maps WSH to WAS so Washington players join
- play-participant athlete IDs extract correctly from the `$ref` URL form
  (`.../athletes/4047365`) and resolve through the crosswalk
- a play with no `participants` array (29 of 193 in the sample) is skipped, not crashed on
- the Sleeper matchup normalizer handles a league with a bye or odd team count and a `null`
  opponent

**Integration (manual, scripted) — no HTTP test host exists:**

- extend `scripts/` with a gameday probe (mirroring `espn-check.ts`) that hits the
  orchestrator and prints per-league freshness, so the Sep 9 rehearsal is checkable from a
  terminal rather than by squinting at the UI
- `/api/gameday` returns 400 for a non-integer or out-of-range week, and 500 with `{ error }`
  when the database is unreachable
- the snapshot write is idempotent: running `scope=live` twice inside one bucket leaves one row

**Component — no React test infrastructure; deliberately deferred.** `npm run smoke` is
extended to render `/gameday` against synced data, covering the loading, empty and error
paths. Adding React Testing Library is out of scope for a 9-day deadline and is noted as
follow-up work.

**CI:** add a `test` step after lint. It must stay hermetic — fixtures only, no network and no
database — consistent with the existing "no third-party dependency in the build gate" note.

---

## Risks and Open Questions

1. **BLOCKER for the timeline: the scheduled sync has never successfully run.** Every row in
   `sync_runs` is a local `npm run sync`; there are no cron-shaped runs, and no `live`-scope
   run has *ever* been recorded. Since snapshots now come from `scope=live` on the game-day
   crons, the day timeline (unit 16) cannot work until `SNAP_COUNT_URL` and `SYNC_SECRET`
   (plus `VERCEL_BYPASS` if Deployment Protection covers production) are set as repository
   secrets and a run is confirmed green. **This is now a feature dependency, not just
   hygiene.**
2. **PRECONDITION: uncommitted work.** `scripts/espn-check.ts`, `src/lib/data/sync-espn.ts`
   and `src/lib/platforms/espn/normalize.ts` carry the ESPN mock-league filter and are
   unpushed; production runs the previous commit. Commit and push before building on them.
   *(Not this plan's job to commit.)*
3. **ESPN's `drafted` flag versus the Impact league.** As of 2026-09-04, league 64251973
   reports `draftDetail.drafted: false` with all 192 picks at `playerId: -1`, and
   `sync-espn.ts` deliberately stores **no rosters** for a pre-draft league. After tonight's
   draft, verify the flag flips true — if ESPN leaves it false, the roster suppression will
   hide a fully drafted league from gameday. Check before Sep 13.
4. **Unverifiable until a live game** (the reason for the Sep 9 checkpoint): the exact shape
   of scoreboard `situation` mid-game; whether live `mMatchup` returns moving points for ESPN
   leagues; and the real update cadence of Sleeper `players_points` (assumed 1-2 minutes,
   which sets the floor on play-feed responsiveness).
5. **The win-probability model has no ground truth.** Mitigated rather than solved: the raw
   toggle, in-UI labelling, and hand-computed unit tests. Do not present it as a prediction.
6. **Guillotine has no opponent rows**, so any code path assuming `opponent_team_id` is
   present will produce nulls for 18 teams. Unit 14 must be built as its own component, and
   units 8-9 must tolerate a league with no head-to-head.
7. **Vercel function duration.** `/api/sync` already sets `maxDuration = 300`; adding the
   snapshot write to `scope=live` must not push it over. Measure after unit 11.
8. **Deferred (resolve during implementation):** the exact poll cadence within 20-30s;
   whether `/gameday` auto-becomes the landing page when games are live or stays an explicit
   link; the snapshot cron cadence (`*/10` versus `*/5`); the precise position-variance
   constants; and whether the play feed reads core plays for all live games or only the
   drilled-in one (start with drill-in only — 826KB times 8 concurrent games is not pollable).

---

## Implementation Notes

- **Read `node_modules/next/dist/docs/` before writing Next.js code**, per `AGENTS.md`. This
  version's caching model differs materially from training data, and one such difference
  already invalidated the original design here.
- `/build` should load the `source-driven-development` skill for the ESPN endpoints — they
  are undocumented and unsupported upstream, so behaviour must be verified against real
  payloads rather than assumed.
- Follow the repo's existing comment density. `sync-espn.ts` and `live.ts` explain *why*
  ("verified rather than assumed: every one of the 382 roster entries..."), and the two
  discarded decisions recorded above are exactly the kind of reasoning that belongs in a
  comment at the point of the decision — particularly why the gameday route keeps
  `force-dynamic` and memoises in-process instead.
- Never compute fantasy points. Sleeper's `players_points` and ESPN's `appliedStatTotal` are
  authoritative; a 0.2 disagreement with the platform's own app destroys trust in the page.
- The Impact standards skills assume .NET plus MUI. This is Next.js with plain CSS and a
  deliberate inline-style convention; **the repo's own conventions win**, and the UI Pattern
  Brief above is the binding spec.
- `/build` never stages or commits. Review the diff and commit yourself.
