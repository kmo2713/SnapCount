---
gate: pre-deploy
status: pass
date: 2026-09-04
environment: production
deploy-blockers: 0
warnings: 3
---

# Pre-Deployment Gate Report

## Date: 2026-09-04
## Project: SnapCount
## Environment: production (Vercel, deployed by push to `main`)

### Overall Status: **PASS** — after remediating one blocker found during the gate

| Check | Status | Owner | Details |
|---|---|---|---|
| Static Security | Pass *(was BLOCKED)* | security-reviewer | 1 blocker found and fixed; 5 warnings, 3 fixed |
| Environment Config | Pass | this command | No new env vars; no CORS wildcard; health endpoint present |
| Dependencies | Pass | this command | **0 production vulnerabilities**; 4 moderate dev-only |
| Build | Pass | this command | Compiles clean, typecheck clean, lint 0 errors |
| Tests | Pass | this command | 62 passing across 3 files (51 → 62 during this gate) |
| Repo Hygiene | Pass | this command | No tracked secrets; `.env*` ignored; chunks hashed |

---

## 🚫 Deploy Blockers

**None remaining.** One was found and fixed during the gate:

### B1 (FIXED) — `/api/analysis` could be made to spend the Anthropic key without limit
`src/app/api/analysis/route.ts`

Unauthenticated `POST` with no rate limit, accepting `refresh: true` which deliberately
skips the database cache and forces a fresh `max_tokens: 16000` Opus call, with
`maxDuration = 120`. `teamId` must be real, but team ids are handed out publicly by
`/api/dashboard`. A trivial loop against the deployed URL billed real money with no
ceiling.

Not "an endpoint lacks authentication" — that is out of scope for this app by design.
This is direct financial abuse of a credentialed third-party service, which is in scope.
**Pre-existing; not introduced by the gameday commits.**

**Fixed** by a per-caller ceiling (20/hour) rather than by authentication — the browser
calls this endpoint, so gating it on the sync secret would mean shipping that secret to
the client.

---

## What the gate changed

Three findings turned out to be the same problem, and the fix for one is the fix for all
three: **an in-process memo can never bound an enumerating caller.** A memo collapses
*identical* work, so it protects against many tabs asking one question and does nothing
against one caller asking many different ones. For live scores the TTL must be seconds,
which guarantees the enumerator outruns it.

This was measured, not assumed. The security reviewer proposed raising the poll memo's
cap from 4 slots to 18 (one per valid week) to stop the thrash. Implemented and tested:
**54 round-robin requests across all 18 weeks rebuilt every time anyway**, because the
15-second TTL expired entries before they could be reused. Only 12 of 18 entries even
survived the warm-up. The suggested fix does not work, and the reason it does not work is
the reason the whole class of finding needed a different tool.

So: `src/lib/rate-limit.ts`, a fixed-window per-caller limiter, applied to the three
endpoints that spend something —

| Endpoint | Limit | Why |
|---|---|---|
| `/api/analysis` | 20/hour | Each miss is a billed Opus call |
| `/api/gameday` | 400/hour | ~10 upstream calls per miss; a real session polling every 25s uses ~144 |
| `/api/gameday/game/[eventId]` | 120/hour | ~1.4MB upstream per miss and the id is enumerable |

The memo cap moved to 18 anyway — it correctly bounds *memory*, which is all it was ever
able to do — and the comments that claimed it bounded abuse were corrected rather than
left to mislead the next reader.

An attempt to verify the limiter by firing 125 requests at a dev server proved nothing
and killed the server: `curl` returns `000` on a dropped connection, and the test counted
anything that was not a 429 as a success. Replaced with **11 unit tests** over the pure
counting logic, which is the part that has to be right.

---

## Warnings (fix before next deploy)

- **W1 — `/api/sync` accepts the secret in the query string** (`route.ts:53`). `?secret=`
  lands in Vercel access logs, browser history, and `Referer` on any outbound link; the
  comparison is also non-constant-time. The `Authorization: Bearer` path already works and
  is what Vercel Cron uses. Fix: accept the header only, compare with `timingSafeEqual`.
  *(Not blocking: the gate itself is correctly placed and runs before any work.)*
- **W2 — No security headers.** `next.config.ts` sets no `headers()` block. Missing HSTS,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `frame-ancestors`.
- **W3 — 4 moderate dev-only CVEs** in the `drizzle-kit` → `@esbuild-kit` chain.
  `npm audit --omit=dev` reports **0**, so nothing vulnerable ships; `drizzle-kit` is a
  devDependency used for migrations. Advisory only.

---

## Passed Checks

**Secrets and credentials**
- `.gitignore` covers `.env*` with `!.env.example`; `git ls-files` matches exactly one
  candidate and every value in it is an empty placeholder or a template.
- No `.pem` / `.key` / `.pfx` / `secrets*` / `.tfstate` tracked anywhere.
- The new test fixture `scoreboard-final.json` is 4.7KB of public scoreboard data — zero
  matches for cookie, token, swid, espn_s2, authorization, bearer, api_key or password.
- **ESPN credentials never reach a client payload.** `ESPN_S2`/`ESPN_SWID` are read only
  in `src/lib/env.ts` and consumed in two server-only places. The SWID reaches Postgres as
  an account key, but no client-serialised query selects those columns — verified across
  `GamedayData`, `GameDetail`, the timeline response and `SnapshotPayload`.
  `/api/health` reports a boolean, never a value.

**Injection**
- No SSRF surface: no user-supplied URL is fetched anywhere. User input reaches only a
  numeric query value on a hardcoded host.
- `season` `^\d{4}$`, `week` integer 1-18, `eventId` `^\d{6,12}$` — each validated at the
  route boundary *and* again in the loader, before any upstream call.
- Every Drizzle query is parameterised. The only raw `sql` templates are static.
- Zero occurrences of `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`,
  `child_process`.

**Migration safety**
- `drizzle/0004_sad_millenium_guard.sql` is additive only: one `CREATE TABLE` plus two
  `CREATE INDEX`. No `DROP`, no `ALTER`, no data movement. Already applied to production.
  Drizzle's journal prevents re-application; the statements would error rather than
  destroy anything if forced.

**Environment**
- No new environment variables. The feature uses the existing `DATABASE_URL`,
  `SLEEPER_USERNAME`, `ESPN_S2`, `ESPN_SWID`, `SYNC_SECRET`.
- No CORS wildcard. `/api/health` present. The only `localhost` reference is a documented
  metadata-base fallback for OG image URLs.
- Source maps are not emitted for the client bundle; chunk names are hashed.

---

## Accepted, not blocking

- `SNAP_COUNT_URL` and `SYNC_SECRET` are still unset as GitHub repository secrets, so the
  scheduled sync has never run and the day timeline will stay empty until they are. A
  configuration gap, not a code defect, and documented in the plan.
- Five architectural warnings from today's `/review` remain open by choice — refactors,
  not defects.
- ESPN's live `situation` shape and live `mMatchup` behaviour cannot be verified until a
  real game (Wed Sep 9, 7:20 PM CT). The tests covering those paths are labelled synthetic
  in the test file itself.

---

## Verdict

**PASS.** Safe to push to `main` and deploy. The one genuine blocker was a pre-existing
financial exposure that this gate is exactly designed to catch, and it is fixed and
tested.
