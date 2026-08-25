# Snap Count

A unified, **read-only** dashboard for viewing your fantasy football teams across
Sleeper, Yahoo and ESPN in one place. Lineup moves, waiver claims and trades
still happen in each platform's own app — Snap Count is for looking, not doing.

**Status:** Sleeper is wired up end to end. Yahoo and ESPN are modelled in the
database but not yet fetched (see [Roadmap](#roadmap)).

---

## Quick start

```bash
npm install
cp .env.example .env.local        # for `next dev`
cp .env.example .env              # for the CLI sync scripts
npm run dev
```

Set `SLEEPER_USERNAME` and you have a working dashboard immediately — with no
database at all, Snap Count falls back to calling the Sleeper API directly on
every page load. Add Postgres when you want it to be fast.

### Adding the Postgres cache

1. Create a Supabase project (free tier is plenty), then copy
   **Project Settings → Database → Connection string → URI**.
2. Put it in `DATABASE_URL` in both `.env` and `.env.local`.
3. Create the tables and do a first sync:

   ```bash
   npm run db:migrate    # apply drizzle/*.sql
   npm run sync          # pulls players, byes, leagues, rosters, matchups, drafts
   ```

The first sync takes about 10 seconds and downloads Sleeper's ~15MB player dump.
Later syncs skip it unless you pass `--players`.

Any Postgres works. For a throwaway local one:

```bash
docker run -d --name snapcount-pg \
  -e POSTGRES_PASSWORD=snapcount -e POSTGRES_DB=snapcount \
  -p 55432:5432 postgres:17-alpine
# DATABASE_URL=postgresql://postgres:snapcount@localhost:55432/snapcount
```

---

## How data flows

```
Sleeper API ─┐
ESPN sched.  ├─► sync jobs ─► Postgres ─┐
(Yahoo)      │   (src/lib/data/sync.ts) ├─► loadDashboard() ─► views
(ESPN)       ┘                          │   (cache-aside)
             └──────── live fallback ───┘
```

`loadDashboard()` is the only entry point the UI uses. It serves from Postgres
when the cache has the current season and falls back to a live Sleeper fetch
otherwise, so the app works before a sync has ever run. Every view consumes the
same platform-agnostic domain model (`src/lib/domain/types.ts`), which is why
none of them contain `if (platform === "sleeper")`.

Typical timings against 7 leagues: **~2.2s** live, **~110ms** cached.

### Layout

| Path | What lives there |
| --- | --- |
| `src/lib/db/schema.ts` | Drizzle schema — all three platforms |
| `src/lib/platforms/sleeper/` | Sleeper client, wire types, normaliser |
| `src/lib/platforms/nfl/schedule.ts` | Bye weeks from ESPN's public scoreboard |
| `src/lib/domain/` | Domain model, analytics, scoring, matchup assembly |
| `src/lib/data/` | `sync` (write), `repo` (read), `live` (fallback), `dashboard` (chooser) |
| `src/components/views/` | One file per view |
| `src/app/api/sync` | Sync trigger, for cron |

---

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run sync` | Full sync (auto-pulls players/byes if missing) |
| `npm run sync -- --players` | Force a player-dump refresh |
| `npm run sync -- --schedule` | Force a bye-week refresh |
| `npm run sync -- --season=2025` | Sync a past season |
| `npm run smoke` | Render every view against real data + empty data |
| `npm run matchup -- Shlong` | Print one head-to-head to the terminal |
| `npm run sync:live` | Current-week scores only (~1s, the game-day job) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` / `db:migrate` | Create / apply migrations |
| `npm run db:studio` | Browse the cache |

---

## Troubleshooting

**"Postgres cache unavailable, served live from Sleeper: …"**

The cache read failed, so Snap Count fell back to calling Sleeper directly — the
page still works, just slower. The warning names the Postgres error code and
what to do about it. Code `42P01` means a table is missing:

```bash
npm run db:migrate
```

That is the usual symptom of pulling code which added a table without running
the migration.

A missing `player_projections` table specifically no longer triggers this:
projections are optional, so they degrade to `—` while the rest of the dashboard
keeps serving from cache.

**"No projections available for … week N"**

Sleeper's projections endpoint is undocumented and only publishes the current
and upcoming weeks. Lineups and scores are unaffected; projection columns show
`—`. Refresh them with `npm run sync`.

---

## Schema notes

Three decisions make the schema hold all three platforms:

1. **No provider id is ever a primary key.** Every upstream row carries
   `platform` plus the provider's own id, so Sleeper roster `4` and an ESPN team
   `4` cannot collide.
2. **Players are one canonical dimension.** Sleeper's dump already carries
   `espn_id` and `yahoo_id`, so it seeds `players` and the other platforms
   resolve into it through `player_aliases`. A Yahoo- or ESPN-only player still
   gets a canonical row plus an alias — nothing is dropped.
3. **`raw` jsonb everywhere.** Anything not normalised yet is still on the row,
   so a view can reach for a field without a migration.

`credentials` is ready for Yahoo tokens and ESPN cookies (ciphertext + IV, never
plaintext) and stays empty until those integrations land.

---

## What is real vs. heuristic

The prototype ran on generated data and used a hash of the player id wherever it
needed a number. Everything below now comes from a real signal:

- **Rosters, lineups, records, matchups, drafts, standings** — Sleeper, verbatim.
- **Weekly projections** — Rotowire, via Sleeper. Crucially, the raw projected
  stat line is multiplied through *each league’s own* `scoring_settings`
  rather than trusting the generic `pts_ppr` figure. Josh Allen’s week-1
  projection is 23.26 under generic PPR but 20.36 in the "Shlong" league — a
  three-point swing on one starter.
- **Injury status** — Sleeper's live designations, refreshed each sync.
- **Bye weeks** — ESPN's public scoreboard feed (`week.teamsOnBye`). No auth; this
  is the open sports endpoint, unrelated to the cookie-gated fantasy API.
- **Lineup slots** — resolved positionally against each league's own
  `roster_positions`, so `SUPER_FLEX` and `WRRB_FLEX` are labelled correctly.
- **Consistency (Boom/Steady/Volatile)** — real week-to-week variance, and shown
  as `—` until a player has at least 3 weeks of scoring.
- **Position grades** — your positional value against the *actual* other rosters
  in that league.

Still heuristics, and labelled as such in the UI:

- **Player value** — Sleeper's `search_rank` blended with season scoring and
  injury status. Good for sanity checks, not a rankings service.
- **Playoff odds** — record, margin and league size. Withheld entirely before any
  games are played rather than printing an invented number.
- **Start/sit and trade reads** — value comparisons that respect real lineup
  eligibility. Claude-generated analysis replaces these in a later phase.

---

## Deploying

Vercel + Supabase. About 20 minutes end to end.

### 1. Supabase

Create a project, then **Project Settings → Database → Connection string → URI**.

Supabase gives you two URIs and the difference matters:

| Port | Use for |
| --- | --- |
| `5432` (session pooler) | Migrations — `npm run db:migrate` |
| `6543` (transaction pooler) | The deployed app — serverless-friendly |

The client already sets `prepare: false`, which the transaction pooler requires.

Point your local `.env` at the **5432** URI and create the schema:

```bash
npm run db:migrate
npm run sync          # first run pulls the ~15MB player dump
```

Do the first sync from your machine, not from a serverless function — it is the
slowest run by far and there is no timeout pressure locally.

### 2. Vercel

Import the repo, then set environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the **6543** Supabase URI |
| `SLEEPER_USERNAME` | `kmo2713` |
| `SYNC_SECRET` | `openssl rand -hex 32` |
| `CRON_SECRET` | the same value as `SYNC_SECRET` |

`CRON_SECRET` is what Vercel Cron sends as a bearer token; the sync route accepts
it because it compares against `SYNC_SECRET`. If they differ, every scheduled run
returns 401.

Deploy, then check:

```
https://<your-app>.vercel.app/api/health
```

That reports row counts, cache age and the last sync error. It returns **503** if
the database is unreachable or the schema is behind, so it is also the right URL
to point uptime monitoring at.

### 3. Scheduled syncs

Two scopes on deliberately different schedules:

| Scope | Cost | When |
| --- | --- | --- |
| `?scope=live` | ~1s | Every few minutes during game windows. Current week's scores only. |
| `?scope=full` | ~7s | Twice a day. Rosters, drafts, projections, trending. |

Scheduling runs from **GitHub Actions** (`.github/workflows/sync.yml`), not
Vercel Cron. Vercel's Hobby plan caps cron frequency and refuses the 5-minute
game-day schedule outright, so `vercel.json` carries only the region pin.

Actions is free, has no frequency cap, and keeps every schedule in one file.
Add two repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `SNAP_COUNT_URL` | deployment URL, e.g. `https://snapcount.vercel.app` |
| `SYNC_SECRET` | same value as the deployment's `SYNC_SECRET` |

Run one by hand from the **Actions** tab → *Sync* → *Run workflow*, picking the
`full` or `live` scope.

Trigger one by hand any time:

```bash
curl -H "Authorization: Bearer $SYNC_SECRET" \
  "https://<your-app>.vercel.app/api/sync?scope=live"
```

### Cron times are UTC

NFL windows are Eastern, so the schedules are offset — and they drift by an hour
when the US leaves daylight saving in early November. The windows are set wide
enough to absorb that, so nothing needs changing mid-season.

### Cost

Both free tiers are comfortable here. The cache is a few thousand rows plus the
12k-row player table; the heaviest job is the daily player dump, which runs from
the full sync only.

---

## Roadmap

Reordered from the brief's build order once it was clear that Sleeper carries
almost all of these leagues.

**Done**

1. Sleeper integration, end to end
2. Data model covering all three platforms
3. Every prototype view on real Sleeper data
4. Head-to-head matchup view with league-scored projections
5. Deployment scaffolding — health endpoint, two sync scopes, cron schedules

**Next**

6. **Deploy** — Vercel + Supabase, per the section above.
7. **Claude-generated analysis** — replace the start/sit and trade heuristics
   with server-side calls carrying real roster, matchup and scoring context.
   The heuristics are honest but shallow; this is where the app stops being a
   viewer and starts giving an opinion.

**Deferred, deliberately**

8. **Yahoo OAuth2** and **ESPN cookie auth**. The schema, `credentials` table
   and `player_aliases` crosswalk already accommodate both — Sleeper's player
   dump carries `espn_id` and `yahoo_id`, so the hard part (identity across
   platforms) is solved and costs nothing to leave unused. Worth doing only if
   the handful of teams on those platforms turns out to matter; the integration
   effort is real, especially Yahoo's.

**Smaller gaps worth knowing about**

- FAAB / waiver budget is synced (`waiverBudgetUsed`) but no view shows it.
- Two leagues are pre-draft, so Draft Recap is empty for them until they draft.
- Projections only exist for the current and upcoming week — Sleeper does not
  publish them further out.
