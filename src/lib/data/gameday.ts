/**
 * The gameday loader: live NFL state and live fantasy scoring, assembled per poll.
 *
 * Deliberately NOT cache-aside. Every other view in this app reads Postgres and
 * falls back to a live fetch; gameday inverts that, because the sync cadence is
 * the problem it exists to solve. The scheduled sync floor is minutes and a
 * touchdown is worth knowing about in seconds, so scores are fetched straight
 * from the platforms on every poll.
 *
 * Postgres is still read, for the things that do not move during a game: who is
 * on which roster, who plays whom, and what each player was projected for. Those
 * come from the last sync and would be wasteful to re-fetch every 20 seconds.
 *
 * Concurrent polls are collapsed by an in-process memo rather than Next's data
 * cache. That is not a preference — the data cache is stale-while-revalidate, so
 * the first request past the window is served the old scores while a refresh
 * happens behind it, and its key includes the cookie header, which would persist
 * ESPN-credentialed private-league responses in a shared regional store. The
 * memo below is the same `globalThis` + TTL + last-known-good idiom `live.ts`
 * already uses for byes and projections.
 */
import { and, eq, inArray } from "drizzle-orm";

import { requireDb, schema } from "@/lib/db/client";
import type {
  GamedayData,
  LineupAlert,
  LiveLeagueRow,
  LiveMatchup,
  LiveMatchupSide,
  NflGame,
  RootingInterest,
} from "@/lib/domain/gameday";
import {
  buildOutlook,
  headToHeadLeverage,
  rootForTeam,
  rootingInterest,
  survivalLeverage,
  survivalProbability,
  winProbability,
  type LeagueRooting,
  type StarterLive,
  type TeamOutlook,
} from "@/lib/domain/rooting";
import type { LeagueFormat, NflStateView, Platform } from "@/lib/domain/types";
import { env, espnCredentials } from "@/lib/env";
import { readEspnLiveWeek } from "./sync-espn";
import { leagueFormat as espnLeagueFormat } from "@/lib/platforms/espn/normalize";
import type { EspnLeagueSettings } from "@/lib/platforms/espn/league-types";
import { fetchScoreboard } from "@/lib/platforms/nfl/scoreboard";
import { sleeper, sleeperAvatarUrl } from "@/lib/platforms/sleeper/client";
import { resolveViewedWeek } from "@/lib/platforms/sleeper/fetch";
import { leagueFormat as sleeperLeagueFormat } from "@/lib/platforms/sleeper/normalize";
import type { SleeperState } from "@/lib/platforms/sleeper/types";

const { leagues, matchups, playerAliases, playerProjections, players, rosterSlots, teams } =
  schema;

/**
 * Designations worth surfacing before kickoff. "Active" and an empty status
 * are the normal case and would drown the list.
 */
const ALERT_STATUSES = new Set([
  "questionable",
  "doubtful",
  "out",
  "ir",
  "injured reserve",
  "pup",
  "sus",
  "suspended",
  "dnr",
]);

/**
 * How long one assembled payload is reused.
 *
 * Short enough that a score is never more than this stale, long enough that a
 * page open in three tabs costs one fan-out rather than three.
 */
const MEMO_TTL_MS = 15_000;

/**
 * How many (season, week) payloads are held at once.
 *
 * Sized to the whole key space rather than to a guess at demand. The key comes
 * from query parameters, so a caller round-robining `?week=` decides the access
 * pattern, not us: with fewer slots than valid weeks, every request evicts an
 * entry it is about to need and the hit rate collapses to zero — one full
 * fan-out each, which is exactly what the memo exists to prevent. Four slots
 * made that harder than one slot did, and no more than that.
 *
 * There are 18 regular-season weeks and the route rejects anything outside
 * them, so holding all 18 makes the thrash arithmetically impossible. At ~57KB
 * a payload that is about 1MB in the worst case, against an unbounded upstream
 * fan-out — a trade worth making twice over.
 */
const MEMO_MAX_KEYS = 18;

/** How long the NFL state is reused. It changes weekly, not per request. */
const STATE_TTL_MS = 5 * 60_000;

const globalForGameday = globalThis as unknown as {
  snapCountGameday?: Map<string, { data: GamedayData; builtAt: number }>;
  /**
   * Builds currently running, keyed the same way.
   *
   * Without this, N concurrent misses on one key each start their own fan-out
   * and the last one to finish wins — the memo only ever helped requests that
   * arrived *after* a build completed, never the thundering herd that arrives
   * during one.
   */
  snapCountGamedayInFlight?: Map<string, Promise<GamedayData>>;
  snapCountNflState?: { state: SleeperState | null; fetchedAt: number };
};

/**
 * The NFL state, memoised.
 *
 * This used to be called on every request *before* the memo check, to resolve
 * the season and week the key is built from — so a "cache hit" still cost a
 * Sleeper round-trip, and the memo was not actually on the path of every
 * upstream call. The client's own `revalidate: 300` cannot help here: the route
 * is `force-dynamic`, which sets `fetchCache = "force-no-store"` for the whole
 * segment and overrides it.
 */
async function cachedState(): Promise<SleeperState | null> {
  const cached = globalForGameday.snapCountNflState;
  if (cached && Date.now() - cached.fetchedAt < STATE_TTL_MS) return cached.state;

  try {
    const state = await sleeper.getState();
    globalForGameday.snapCountNflState = { state, fetchedAt: Date.now() };
    return state;
  } catch {
    // Last known good beats failing the page over a week number.
    return cached?.state ?? null;
  }
}

/** Drops expired entries, then the oldest, until the map is within its cap. */
function evict(store: Map<string, { builtAt: number }>): void {
  for (const [key, entry] of store) {
    if (Date.now() - entry.builtAt >= MEMO_TTL_MS) store.delete(key);
  }
  while (store.size > MEMO_MAX_KEYS) {
    const oldest = [...store.entries()].sort((a, b) => a[1].builtAt - b[1].builtAt)[0];
    if (!oldest) break;
    store.delete(oldest[0]);
  }
}

/* -------------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------------- */

const toNum = (v: string | number | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : Number(v);

function avatarUrl(platform: string, value: string | null | undefined): string | null {
  if (!value) return null;
  return platform === "sleeper" ? sleeperAvatarUrl(value) : value;
}

/** An empty outlook, for a team we have rosters for but no live score yet. */
function emptyOutlook(score: number): TeamOutlook {
  return {
    score,
    remaining: 0,
    variance: 0,
    yetToPlay: 0,
    inProgress: 0,
    done: 0,
    remainingByGame: new Map(),
  };
}

function toSide(
  teamId: string,
  teamName: string,
  avatar: string | null,
  outlook: TeamOutlook,
): LiveMatchupSide {
  return {
    teamId,
    teamName,
    avatar,
    score: outlook.score,
    remaining: outlook.remaining,
    yetToPlay: outlook.yetToPlay,
    inProgress: outlook.inProgress,
    done: outlook.done,
  };
}

/* -------------------------------------------------------------------------
   Load
   ------------------------------------------------------------------------- */

export interface GamedayOptions {
  week?: number;
  season?: string;
  /** Skip the memo. Only the poll endpoint's explicit refresh should do this. */
  force?: boolean;
}

export async function loadGameday(options: GamedayOptions = {}): Promise<GamedayData> {
  const state = await cachedState();
  const season =
    options.season ?? env.season ?? state?.league_season ?? state?.season ?? "";
  const week = options.week ?? (state ? resolveViewedWeek(state) : 1);

  const key = `${season}:${week}`;
  /*
   * Shape-checked, not just presence-checked. These live on globalThis, which
   * survives a hot reload and a warm serverless instance across a deploy — so
   * a release that changes the shape can find the previous one still sitting
   * there. `??=` keeps whatever is truthy, which turned a memo redesign into
   * "store.get is not a function" on every request until the process recycled.
   */
  const existingStore = globalForGameday.snapCountGameday;
  const store =
    existingStore instanceof Map
      ? existingStore
      : (globalForGameday.snapCountGameday = new Map());

  const existingInFlight = globalForGameday.snapCountGamedayInFlight;
  const inFlight =
    existingInFlight instanceof Map
      ? existingInFlight
      : (globalForGameday.snapCountGamedayInFlight = new Map());
  const cached = store.get(key);

  if (!options.force && cached && Date.now() - cached.builtAt < MEMO_TTL_MS) {
    return cached.data;
  }

  // Someone is already building exactly this. Wait for theirs rather than
  // starting a second identical fan-out.
  const running = inFlight.get(key);
  if (running && !options.force) return running;

  const build$ = build(season, week, state)
    .then((data) => {
      store.set(key, { data, builtAt: Date.now() });
      evict(store);
      return data;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, build$);

  try {
    return await build$;
  } catch (err) {
    /*
     * Serve the last good payload rather than an error page. A dropped poll
     * mid-drive should show scores that are a minute old with a warning, not
     * blank the screen — the same trade `live.ts` makes for byes.
     */
    if (cached) {
      return {
        ...cached.data,
        warnings: [
          ...cached.data.warnings,
          `Refresh failed, showing the last good data: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }
    throw err;
  }
}

async function build(
  season: string,
  week: number,
  state: SleeperState | null,
): Promise<GamedayData> {
  const db = requireDb();
  const warnings: string[] = [];

  /* -- 1. Everything that does not move during a game, from Postgres -- */

  const leagueRows = await db
    .select({
      id: leagues.id,
      platform: leagues.platform,
      platformLeagueId: leagues.platformLeagueId,
      name: leagues.name,
      avatar: leagues.avatar,
      status: leagues.status,
      settings: leagues.settings,
    })
    .from(leagues)
    .where(eq(leagues.season, season));

  // A league that has not drafted has no lineups to score.
  const active = leagueRows.filter(
    (l) => l.status !== "pre_draft" && l.status !== "drafting",
  );

  if (active.length === 0) {
    return emptyPayload(state, season, week, [
      leagueRows.length === 0
        ? `No leagues cached for ${season}. Run \`npm run sync\` first.`
        : `All ${leagueRows.length} cached league(s) are still pre-draft.`,
    ]);
  }

  const leagueIds = active.map((l) => l.id);

  const teamRows = await db
    .select({
      id: teams.id,
      leagueId: teams.leagueId,
      platformTeamId: teams.platformTeamId,
      name: teams.name,
      avatar: teams.avatar,
      isMine: teams.isMine,
    })
    .from(teams)
    .where(inArray(teams.leagueId, leagueIds));

  const starterRows = await db
    .select({
      teamId: rosterSlots.teamId,
      playerId: rosterSlots.playerId,
      name: players.fullName,
      position: players.position,
      nflTeam: players.nflTeam,
      status: players.status,
      injuryStatus: players.injuryStatus,
    })
    .from(rosterSlots)
    .innerJoin(players, eq(players.id, rosterSlots.playerId))
    .where(
      and(
        inArray(
          rosterSlots.teamId,
          teamRows.map((t) => t.id),
        ),
        eq(rosterSlots.kind, "starter"),
      ),
    );

  const matchupRows = await db
    .select({
      leagueId: matchups.leagueId,
      teamId: matchups.teamId,
      opponentTeamId: matchups.opponentTeamId,
    })
    .from(matchups)
    .where(and(inArray(matchups.leagueId, leagueIds), eq(matchups.week, week)));

  const projectionRows = await db
    .select({
      playerId: playerProjections.playerId,
      ptsPpr: playerProjections.ptsPpr,
      ptsHalfPpr: playerProjections.ptsHalfPpr,
      ptsStd: playerProjections.ptsStd,
    })
    .from(playerProjections)
    .where(and(eq(playerProjections.season, season), eq(playerProjections.week, week)));

  /*
   * PPR with the other two as fallbacks. Scoring per league would be more
   * correct, but a projection is an estimate being fed to a model that is
   * itself an estimate — the extra precision would not survive the leverage
   * weighting, and it would cost a per-league scoring pass on every poll.
   */
  const projectionByPlayer = new Map<string, number>();
  for (const p of projectionRows) {
    const value = p.ptsPpr ?? p.ptsHalfPpr ?? p.ptsStd;
    if (value != null) projectionByPlayer.set(p.playerId, value);
  }

  /* -- 2. Live, fanned out -- */

  const espnLeagues = active.filter((l) => l.platform === "espn");
  const sleeperLeagues = active.filter((l) => l.platform === "sleeper");

  const canonicalId = new Map<string, string>();
  if (espnLeagues.length > 0 && espnCredentials()) {
    const aliasRows = await db
      .select({
        platformPlayerId: playerAliases.platformPlayerId,
        playerId: playerAliases.playerId,
      })
      .from(playerAliases)
      .where(eq(playerAliases.platform, "espn"));
    for (const a of aliasRows) canonicalId.set(a.platformPlayerId, a.playerId);
  }

  /*
   * One scoreboard call plus one call per league, all at once. Each is
   * individually guarded: a league that fails becomes a warning and an empty
   * score set, never a failed page — the same contract `live.ts` uses.
   */
  const [scoreboard, sleeperResults, espnResults] = await Promise.all([
    fetchScoreboard(season, week).catch((err) => {
      warnings.push(
        `NFL scoreboard unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { games: [] as NflGame[], warnings: [] as string[] };
    }),
    Promise.all(
      sleeperLeagues.map(async (league) => {
        try {
          // revalidate 0: never the data cache for live scores.
          const rows = await sleeper.getMatchups(league.platformLeagueId, week, 0);
          return { league, rows: rows ?? [] };
        } catch (err) {
          warnings.push(
            `Live scores for "${league.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return { league, rows: [] };
        }
      }),
    ),
    Promise.all(
      espnLeagues.map(async (league) => {
        if (canonicalId.size === 0) return { league, teams: [] };
        try {
          const live = await readEspnLiveWeek(
            league.platformLeagueId,
            season,
            week,
            canonicalId,
          );
          return { league, teams: live.teams };
        } catch (err) {
          warnings.push(
            `Live scores for "${league.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return { league, teams: [] };
        }
      }),
    ),
  ]);

  warnings.push(...scoreboard.warnings);
  const games = scoreboard.games;

  /* -- 3. Join players to the games they are playing in -- */

  const gameByTeam = new Map<string, NflGame>();
  for (const game of games) {
    if (game.home.abbr) gameByTeam.set(game.home.abbr, game);
    if (game.away.abbr) gameByTeam.set(game.away.abbr, game);
  }

  /** teamId -> live points for each of its players. */
  const playerPointsByTeam = new Map<string, Map<string, number>>();
  /** teamId -> the platform's own team total. */
  const teamScore = new Map<string, number>();

  const teamIdByPlatformId = new Map<string, string>();
  for (const t of teamRows) {
    teamIdByPlatformId.set(`${t.leagueId}:${t.platformTeamId}`, t.id);
  }

  for (const { league, rows } of sleeperResults) {
    for (const row of rows) {
      const teamId = teamIdByPlatformId.get(`${league.id}:${row.roster_id}`);
      if (!teamId) continue;
      teamScore.set(teamId, toNum(row.custom_points ?? row.points));
      const points = new Map<string, number>();
      for (const [playerId, value] of Object.entries(row.players_points ?? {})) {
        points.set(playerId, value);
      }
      playerPointsByTeam.set(teamId, points);
    }
  }

  for (const { league, teams: espnTeams } of espnResults) {
    for (const row of espnTeams) {
      const teamId = teamIdByPlatformId.get(`${league.id}:${row.espnTeamId}`);
      if (!teamId) continue;
      teamScore.set(teamId, row.points ?? 0);
      const points = new Map<string, number>();
      for (const p of row.players) points.set(p.playerId, p.points);
      playerPointsByTeam.set(teamId, points);
    }
  }

  /** teamId -> its starters, as the model wants them. */
  const startersByTeam = new Map<string, StarterLive[]>();
  for (const row of starterRows) {
    const game = row.nflTeam ? gameByTeam.get(row.nflTeam) : undefined;
    const list = startersByTeam.get(row.teamId) ?? [];
    list.push({
      playerId: row.playerId,
      position: row.position ?? "",
      eventId: game?.eventId ?? null,
      gameState: game?.state ?? null,
      points: playerPointsByTeam.get(row.teamId)?.get(row.playerId) ?? 0,
      projection: projectionByPlayer.get(row.playerId) ?? null,
    });
    startersByTeam.set(row.teamId, list);
  }

  const outlookByTeam = new Map<string, TeamOutlook>();
  for (const t of teamRows) {
    outlookByTeam.set(
      t.id,
      buildOutlook(teamScore.get(t.id) ?? 0, startersByTeam.get(t.id) ?? []),
    );
  }

  /* -- 4. Per-league matchups and rooting inputs -- */

  const opponentByTeam = new Map<string, string | null>();
  for (const m of matchupRows) opponentByTeam.set(m.teamId, m.opponentTeamId);

  const liveMatchups: LiveMatchup[] = [];
  const rootingInputs: LeagueRooting[] = [];

  for (const league of active) {
    const platform = league.platform as Platform;
    const leagueTeams = teamRows.filter((t) => t.leagueId === league.id);
    const mineRow = leagueTeams.find((t) => t.isMine);
    if (!mineRow) continue;

    const mine = outlookByTeam.get(mineRow.id) ?? emptyOutlook(0);
    const opponentId = opponentByTeam.get(mineRow.id) ?? null;
    const opponentRow = opponentId
      ? (leagueTeams.find((t) => t.id === opponentId) ?? null)
      : null;
    const opponent = opponentRow ? (outlookByTeam.get(opponentRow.id) ?? null) : null;

    /*
     * Survival is detected from the data, not from the league's format label:
     * a league whose matchup rows carry no opponent has no head-to-head, which
     * is exactly the condition that breaks the model. Guillotine is the reason
     * this exists, but anything shaped like it gets the same treatment without
     * needing to be recognised by name.
     */
    const isSurvival = opponent === null;
    const field = leagueTeams
      .filter((t) => t.id !== mineRow.id)
      .map((t) => outlookByTeam.get(t.id) ?? emptyOutlook(0));

    const standings: LiveLeagueRow[] = leagueTeams
      .map((t) => {
        const o = outlookByTeam.get(t.id) ?? emptyOutlook(0);
        return {
          teamId: t.id,
          teamName: t.name ?? "Unnamed",
          isMine: t.isMine,
          score: o.score,
          remaining: o.remaining,
          yetToPlay: o.yetToPlay,
        };
      })
      .sort((a, b) => b.score - a.score);

    liveMatchups.push({
      leagueId: league.id,
      leagueName: league.name,
      leagueAvatar: avatarUrl(platform, league.avatar),
      platform,
      leagueFormat: formatFor(platform, league.settings),
      week,
      mine: toSide(mineRow.id, mineRow.name ?? "My team", mineRow.avatar, mine),
      opponent:
        opponentRow && opponent
          ? toSide(opponentRow.id, opponentRow.name ?? "Opponent", opponentRow.avatar, opponent)
          : null,
      winProbability: isSurvival ? null : winProbability(mine, opponent!),
      survival: isSurvival ? survivalProbability(mine, field) : null,
      liveRank: standings.findIndex((s) => s.isMine) + 1,
      totalTeams: leagueTeams.length,
      standings,
    });

    /*
     * Rivals differ by format. Head-to-head has exactly one, weighted the same
     * as the user's own points because the normal difference is symmetric. A
     * survival league has every other team, each weighted by its own effect on
     * the user's survival — which naturally drops out the teams far above them
     * without needing a rule that says so.
     */
    const myWeight = isSurvival
      ? survivalLeverage(mine, field)
      : headToHeadLeverage(mine, opponent!);

    const rivals = isSurvival
      ? leagueTeams
          .filter((t) => t.id !== mineRow.id)
          .map((t) => {
            const rival = outlookByTeam.get(t.id) ?? emptyOutlook(0);
            const others = field.filter((f) => f !== rival);
            // How much this one rival scoring hurts: the drop in survival when
            // they gain a point.
            const before = survivalProbability(mine, [rival, ...others]);
            const after = survivalProbability(mine, [
              { ...rival, score: rival.score + 1 },
              ...others,
            ]);
            return { weight: Math.max(0, before - after), remainingByGame: rival.remainingByGame };
          })
      : opponent
        ? [{ weight: myWeight, remainingByGame: opponent.remainingByGame }]
        : [];

    const countByGame = (outlook: TeamOutlook | null): Map<string, number> => {
      const counts = new Map<string, number>();
      if (!outlook) return counts;
      for (const eventId of outlook.remainingByGame.keys()) {
        counts.set(eventId, (counts.get(eventId) ?? 0) + 1);
      }
      return counts;
    };

    rootingInputs.push({
      leagueId: league.id,
      leagueName: league.name,
      platform,
      myWeight,
      myRemainingByGame: mine.remainingByGame,
      rivals,
      myStartersByGame: countByGame(mine),
      opponentStartersByGame: countByGame(opponent),
    });
  }

  /* -- 5. Rooting interest, both modes -- */

  const slate = games.map((g) => ({
    eventId: g.eventId,
    home: g.home.abbr,
    away: g.away.abbr,
  }));

  /*
   * Roster presence per NFL team: how many of your starters play for each, and
   * how many of the teams you are actually facing this week do. The second set
   * is deliberately only your opponents rather than every rostered player in
   * every league — a player on some other team in your league is not playing
   * against you, and counting him would make almost every game look hostile.
   */
  const teamById = new Map(teamRows.map((t) => [t.id, t]));
  const opponentIds = new Set<string>();
  for (const league of active) {
    const mineRow = teamRows.find((t) => t.leagueId === league.id && t.isMine);
    if (!mineRow) continue;
    const opponentId = opponentByTeam.get(mineRow.id);
    if (opponentId) opponentIds.add(opponentId);
  }

  /*
   * An injury designation only matters where the player is actually starting —
   * the same name on a bench somewhere is not a decision you have to make. The
   * alert therefore carries the leagues you start them in, and nothing else.
   */
  const alertByPlayer = new Map<string, LineupAlert>();
  const leagueNameById = new Map(active.map((l) => [l.id, l.name]));

  const minePresence: Record<string, number> = {};
  const againstPresence: Record<string, number> = {};
  const myTeams = new Set<string>();

  for (const row of starterRows) {
    if (!row.nflTeam) continue;
    const team = teamById.get(row.teamId);
    if (!team) continue;

    if (team.isMine) {
      myTeams.add(row.nflTeam);
      minePresence[row.nflTeam] = (minePresence[row.nflTeam] ?? 0) + 1;

      const designation = (row.injuryStatus ?? row.status ?? "").trim();
      if (designation && ALERT_STATUSES.has(designation.toLowerCase())) {
        const game = gameByTeam.get(row.nflTeam);
        const existing = alertByPlayer.get(row.playerId);
        const league = {
          leagueId: team.leagueId,
          leagueName: leagueNameById.get(team.leagueId) ?? "",
        };
        if (existing) {
          existing.leagues.push(league);
        } else {
          alertByPlayer.set(row.playerId, {
            playerId: row.playerId,
            name: row.name,
            position: row.position ?? "",
            nflTeam: row.nflTeam,
            status: designation,
            leagues: [league],
            kickoff: game?.kickoff ?? null,
            gameState: game?.state ?? null,
          });
        }
      }
    } else if (opponentIds.has(team.id)) {
      againstPresence[row.nflTeam] = (againstPresence[row.nflTeam] ?? 0) + 1;
    }
  }

  const withRootFor = (list: RootingInterest[]): RootingInterest[] =>
    list.map((interest) => {
      const game = slate.find((g) => g.eventId === interest.eventId);
      return game
        ? { ...interest, rootFor: rootForTeam(interest, game, myTeams) }
        : interest;
    });

  return {
    state: toStateView(state, season, week),
    viewedWeek: week,
    generatedAt: new Date().toISOString(),
    anyLive: games.some((g) => g.state === "in"),
    games,
    matchups: liveMatchups,
    rooting: {
      leverage: withRootFor(rootingInterest(rootingInputs, slate, "leverage")),
      raw: withRootFor(rootingInterest(rootingInputs, slate, "raw")),
    },
    presence: { mine: minePresence, against: againstPresence },
    alerts: [...alertByPlayer.values()].sort((a, b) => {
      // Games that have not locked yet first: those are the only ones you can
      // still do anything about.
      const aOpen = a.gameState === "pre" ? 0 : 1;
      const bOpen = b.gameState === "pre" ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return (a.kickoff ?? "").localeCompare(b.kickoff ?? "");
    }),
    source: "live",
    warnings,
  };
}

function formatFor(
  platform: Platform,
  settings: unknown,
): LeagueFormat | null {
  return platform === "espn"
    ? espnLeagueFormat(settings as EspnLeagueSettings | null)
    : sleeperLeagueFormat((settings ?? null) as Record<string, number> | null);
}

function toStateView(
  state: SleeperState | null,
  season: string,
  week: number,
): NflStateView {
  return {
    season: state?.season ?? season,
    seasonType: state?.season_type ?? "regular",
    week: state?.week ?? week,
    displayWeek: state?.display_week ?? week,
    inSeason: (state?.season_type ?? "regular") === "regular",
  };
}

function emptyPayload(
  state: SleeperState | null,
  season: string,
  week: number,
  warnings: string[],
): GamedayData {
  return {
    state: toStateView(state, season, week),
    viewedWeek: week,
    generatedAt: new Date().toISOString(),
    anyLive: false,
    games: [],
    matchups: [],
    rooting: { leverage: [], raw: [] },
    presence: { mine: {}, against: {} },
    alerts: [],
    source: "live",
    warnings,
  };
}
