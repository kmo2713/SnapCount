# Snap Count — handoff brief for Claude Code

## What this is
A unified dashboard for viewing fantasy football teams across Sleeper, Yahoo, and ESPN in one place — rosters, matchups, news, start/sit, draft, and trade help — instead of three separate apps. Read-only for now: changes (lineup moves, waiver claims, trades) still happen in each platform's own app.

## What exists already
A working prototype (`snap-count.jsx`, attached) built as a React artifact in claude.ai. It proves out the UI/UX with realistic sample data shaped exactly like the real APIs, but **runs entirely on generated mock data** — the artifact sandbox blocks outbound fetch calls, so nothing in it talks to a real API yet. Treat it as the design spec, not a codebase to import wholesale (it's a single 1,100-line file with no backend, no auth, no persistence).

Views to carry over, all working against mock data today:
- **Overview** — grid of every team across all platforms, combined record, a "This week" briefing card (injured starters, start/sit flags, closest matchup, a gap-aware waiver suggestion)
- **Power Rankings** — cross-league ranked list with a composite score, tier badges, simple playoff-odds estimate, position grade chips
- **Standings** — full per-league table (not just your team), your row highlighted
- **Teams** — drill into any team: roster (QB/RB/WR/TE/FLEX/K/DEF ordered), starters vs. bench, position grades (A–F) computed against real opponents in that league
- **Players** — searchable/filterable across everything you roster, with a Boom/Steady/Volatile consistency tag
- **Lineups** — start/sit view flagging bench players who'd outscore a starter
- **Injury Watch** — every non-active player across all teams, starters first
- **Bye Weeks** — grid of starters-on-bye per week per team, with a called-out list of actual collisions
- **Charts** — weekly point trend, points-for by team, position mix
- **Trades** — pick one of your teams, pick a real opponent in that league, build a hypothetical trade with a value read
- **Draft Recap** — pulled from real Sleeper draft data in the prototype
- **Waiver Wire** — trending adds, with gap-aware recommendations based on position grades

Design system: dark "under the lights" theme (`#10151A` background, `#F2A63D` amber accent, `#4C9A5B` green), Oswald for display type, Inter for body, IBM Plex Mono for numbers. Fixed header + sidebar, only the content pane scrolls. Worth preserving this look unless there's a reason to change it.

## Data source integration — this is the real work

**Sleeper — easy.** Fully public REST API, no auth, no API key. Base URL `https://api.sleeper.app/v1/`. Rate limit ~90 req/min per IP. Key endpoints: `/user/{username}`, `/user/{user_id}/leagues/nfl/{season}`, `/league/{league_id}/rosters`, `/league/{league_id}/users`, `/league/{league_id}/matchups/{week}`, `/league/{league_id}/drafts`, `/draft/{draft_id}/picks`, `/players/nfl` (full dump, ~5MB, fetch at most once a day and cache), `/players/nfl/trending/add`, `/state/nfl`. This can be called directly from a server route with no setup.

**Yahoo — needs OAuth2.** Register a developer app at the Yahoo Developer Network to get a client ID/secret (free). Standard OAuth2 flow: redirect user to Yahoo's consent screen once, exchange the code for an access + refresh token, store both server-side (encrypted), refresh automatically. Yahoo's Fantasy Sports API is notoriously awkward — expect to lean on a wrapper library or plan extra time for the response format.

**ESPN — no official API.** The community-standard unofficial API needs two cookie values, `espn_s2` and `SWID`, pulled from the user's browser after they log into ESPN's site (Application/Storage → Cookies → fantasy.espn.com). This can't be automated — it's a one-time manual copy/paste step for the user. Store both encrypted server-side alongside league ID. Treat this integration as more fragile than the other two; ESPN can change the endpoint without notice.

## Suggested architecture
- Small backend (Node/Next.js API routes, or a separate service) to own the Yahoo OAuth flow, encrypted credential storage, and scheduled sync jobs
- A database (Postgres — Supabase is a reasonable managed option) to cache league/roster/matchup data so the UI isn't waiting on live API calls every load, and to store per-user Yahoo tokens / ESPN cookies
- Scheduled sync (cron or similar) pulling fresh data periodically, more frequently during live game windows
- Frontend reuses the views and design system from the prototype, now backed by real synced data instead of mock generators
- Start/sit, trade, and draft analysis: call the Claude API server-side with the real roster/matchup/scoring data bundled into the prompt, replacing the heuristic placeholders in the prototype (deterministic "value" hash, bench-outscores-starter flag, etc.)
- Deploy somewhere persistent (Vercel is a natural fit for a Next.js app) so this becomes an actual daily-use bookmark, not a one-off session

## Suggested build order
1. Sleeper integration first — it's the only one with zero auth friction, and gets a real end-to-end vertical slice working fast (fetch → store → render Overview + Teams)
2. Data model / DB schema for teams, rosters, players, matchups — designed to fit all three platforms even though only Sleeper is wired up yet
3. Port the rest of the views over one at a time against real Sleeper data
4. Yahoo OAuth flow
5. ESPN cookie-based auth flow
6. Claude-generated start/sit, trade, and draft analysis replacing the heuristics
7. Deployment

## Known accounts / details from this conversation
- Sleeper username: `kmo2713`
- User has 7+ leagues total across Sleeper, Yahoo, and ESPN
