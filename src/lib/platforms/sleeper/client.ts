/**
 * Sleeper REST client.
 *
 * Sleeper is fully public — no key, no OAuth, no cookies. The only real
 * constraint is a documented ~1000 calls/minute per IP; we stay well inside it
 * with a small concurrency gate and retry-on-429/5xx, because a full sync of 7
 * leagues fans out to roughly 7 x (league + users + rosters + N weeks).
 */
import type {
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeague,
  SleeperLeagueUser,
  SleeperMatchup,
  SleeperPlayerMap,
  SleeperProjection,
  SleeperRoster,
  SleeperState,
  SleeperTrendingPlayer,
  SleeperUser,
} from "./types";

const BASE_URL = "https://api.sleeper.app/v1";

/**
 * Projections live on a different host and outside /v1. This endpoint is not in
 * Sleeper's published docs — it backs their own app — so treat it as best
 * effort: callers degrade to "no projections" rather than failing.
 */
const PROJECTIONS_BASE_URL = "https://api.sleeper.com";

/** Max in-flight requests. Sleeper tolerates far more; this is politeness. */
const MAX_CONCURRENCY = 6;

let inFlight = 0;
const queue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENCY) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  inFlight++;
}

function release(): void {
  inFlight--;
  const next = queue.shift();
  if (next) next();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SleeperApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "SleeperApiError";
  }
}

interface FetchOptions {
  /** Retries on 429/5xx before giving up. */
  retries?: number;
  /** Next.js data-cache lifetime in seconds. 0 disables caching. */
  revalidate?: number;
  /** Override the host — projections live off a different one. */
  baseUrl?: string;
}

/**
 * Fetches a Sleeper path and parses JSON.
 *
 * Sleeper answers "no such thing" with a 200 and a literal `null` body rather
 * than a 404, so callers must handle null returns; a genuine 404 also maps to
 * null so both spellings behave the same.
 */
async function fetchJson<T>(
  path: string,
  { retries = 3, revalidate = 0, baseUrl = BASE_URL }: FetchOptions = {},
): Promise<T | null> {
  await acquire();
  try {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`${baseUrl}${path}`, {
          headers: { accept: "application/json" },
          next: revalidate > 0 ? { revalidate } : { revalidate: 0 },
        });

        if (res.status === 404) return null;

        if (res.status === 429 || res.status >= 500) {
          lastError = new SleeperApiError(
            `Sleeper responded ${res.status}`,
            res.status,
            path,
          );
          // Exponential backoff: 500ms, 1s, 2s.
          if (attempt < retries) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw lastError;
        }

        if (!res.ok) {
          throw new SleeperApiError(
            `Sleeper responded ${res.status}`,
            res.status,
            path,
          );
        }

        const text = await res.text();
        if (!text || text === "null") return null;
        return JSON.parse(text) as T;
      } catch (err) {
        lastError = err;
        if (err instanceof SleeperApiError && err.status < 500 && err.status !== 429) {
          throw err;
        }
        if (attempt === retries) break;
        await sleep(500 * 2 ** attempt);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new SleeperApiError("Sleeper request failed", 0, path);
  } finally {
    release();
  }
}

/* ------------------------------------------------------------------ */

export const sleeper = {
  /** Current NFL season/week. Cheap; refresh every few minutes. */
  getState: () => fetchJson<SleeperState>("/state/nfl", { revalidate: 300 }),

  getUser: (username: string) =>
    fetchJson<SleeperUser>(`/user/${encodeURIComponent(username)}`, {
      revalidate: 3600,
    }),

  getLeagues: (userId: string, season: string) =>
    fetchJson<SleeperLeague[]>(`/user/${userId}/leagues/nfl/${season}`, {
      revalidate: 300,
    }),

  getLeague: (leagueId: string) =>
    fetchJson<SleeperLeague>(`/league/${leagueId}`, { revalidate: 300 }),

  getLeagueUsers: (leagueId: string) =>
    fetchJson<SleeperLeagueUser[]>(`/league/${leagueId}/users`, {
      revalidate: 300,
    }),

  getRosters: (leagueId: string) =>
    fetchJson<SleeperRoster[]>(`/league/${leagueId}/rosters`, { revalidate: 120 }),

  /**
   * A league's matchups for a week, including `players_points`.
   *
   * The 120s default suits the dashboard, where a two-minute-old score is
   * fine. Game day is not that: `revalidate: 0` there, because the caller
   * collapses concurrent polls in-process instead, and Next's data cache is
   * stale-while-revalidate — it would serve the *previous* score while
   * refreshing behind it, which is precisely the wrong behaviour for a live
   * scoreboard.
   */
  getMatchups: (leagueId: string, week: number, revalidate = 120) =>
    fetchJson<SleeperMatchup[]>(`/league/${leagueId}/matchups/${week}`, {
      revalidate,
    }),

  getDrafts: (leagueId: string) =>
    fetchJson<SleeperDraft[]>(`/league/${leagueId}/drafts`, { revalidate: 3600 }),

  getDraftPicks: (draftId: string) =>
    fetchJson<SleeperDraftPick[]>(`/draft/${draftId}/picks`, { revalidate: 3600 }),

  /**
   * The full ~15MB / 12k-row player dump. Sleeper explicitly asks that this be
   * pulled at most once per day — only the sync job should call it.
   */
  getAllPlayers: () =>
    fetchJson<SleeperPlayerMap>("/players/nfl", { retries: 2, revalidate: 0 }),

  getTrending: (kind: "add" | "drop", lookbackHours = 24, limit = 25) =>
    fetchJson<SleeperTrendingPlayer[]>(
      `/players/nfl/trending/${kind}?lookback_hours=${lookbackHours}&limit=${limit}`,
      { revalidate: 900 },
    ),

  /**
   * Weekly projections for every fantasy-relevant player. Undocumented, so it
   * gets fewer retries and callers must tolerate null.
   */
  getProjections: (season: string, week: number, seasonType = "regular") => {
    const positions = ["QB", "RB", "WR", "TE", "K", "DEF"]
      .map((p) => `position[]=${p}`)
      .join("&");
    return fetchJson<SleeperProjection[]>(
      `/projections/nfl/${season}/${week}?season_type=${seasonType}&${positions}&order_by=ppr`,
      // ~2.8MB, over Next’s 2MB data-cache ceiling — asking it to cache this
      // only produces a warning per request. The sync job persists projections
      // to Postgres, and live mode memoises them in-process instead.
      { baseUrl: PROJECTIONS_BASE_URL, retries: 1, revalidate: 0 },
    );
  },
};

/** Avatar URL helper — Sleeper serves these off its CDN, not the API host. */
export function sleeperAvatarUrl(
  avatarId: string | null | undefined,
  size: "full" | "thumb" = "thumb",
): string | null {
  if (!avatarId) return null;
  return size === "thumb"
    ? `https://sleepercdn.com/avatars/thumbs/${avatarId}`
    : `https://sleepercdn.com/avatars/${avatarId}`;
}
