/**
 * ESPN fantasy REST client.
 *
 * Unlike Sleeper, none of this is documented or supported. Two consequences
 * shape the code below:
 *
 *  - The host is `lm-api-reads.fantasy.espn.com`, which is *not* the
 *    `site.api.espn.com` host the bye-week feed uses. That one is the public
 *    scoreboard API; this one backs the fantasy product and can change without
 *    notice.
 *  - Listing endpoints are paged through an `x-fantasy-filter` JSON header
 *    rather than query parameters. Omitting it silently returns 50 rows, which
 *    looks like success — so the filter is always sent explicitly.
 *
 * Reads of a private league additionally need the `espn_s2` and `SWID` cookies
 * copied out of a browser session; the player and team endpoints used by the
 * crosswalk are public and need none.
 */
import type {
  EspnErrorResponse,
  EspnFanResponse,
  EspnPlayer,
  EspnProTeam,
  EspnSeasonResponse,
} from "./types";

const BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

/** The account's own follows live on a different host again. */
const FAN_BASE_URL = "https://fan.api.espn.com/apis/v2";

/**
 * Comfortably above the ~11.6k players ESPN currently returns. The header is
 * an upper bound, not a page size — ESPN answers with everything it has.
 */
const PLAYER_FETCH_LIMIT = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class EspnApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    /** ESPN's own error code, e.g. "AUTH_LEAGUE_NOT_VISIBLE". */
    readonly detailType: string | null = null,
  ) {
    super(message);
    this.name = "EspnApiError";
  }

  /** True when the cookies are missing, wrong, or have expired. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.detailType === "AUTH_LEAGUE_NOT_VISIBLE";
  }
}

export interface EspnCredentials {
  espnS2: string;
  swid: string;
}

interface FetchOptions {
  retries?: number;
  /** Serialised into the `x-fantasy-filter` header. */
  filter?: unknown;
  /** Private-league reads only; the public endpoints ignore this. */
  credentials?: EspnCredentials | null;
  /** Override the host — the fan API lives elsewhere. */
  baseUrl?: string;
}

async function fetchJson<T>(
  path: string,
  { retries = 2, filter, credentials, baseUrl = BASE_URL }: FetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (filter !== undefined) headers["x-fantasy-filter"] = JSON.stringify(filter);
  if (credentials) {
    headers.cookie = `espn_s2=${credentials.espnS2}; SWID=${credentials.swid}`;
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // These payloads run to megabytes, well past Next's data-cache ceiling;
      // the sync job persists to Postgres instead of leaning on a fetch cache.
      const res = await fetch(`${baseUrl}${path}`, {
        headers,
        cache: "no-store",
      });

      if (res.ok) return (await res.json()) as T;

      // Errors are small and carry the useful part in the body, so read it
      // before deciding whether the failure is worth retrying.
      const detail = await readError(res);
      const err = new EspnApiError(
        detail.message ?? `ESPN responded ${res.status}`,
        res.status,
        path,
        detail.type,
      );
      if (res.status !== 429 && res.status < 500) throw err;
      lastError = err;
    } catch (err) {
      if (err instanceof EspnApiError && err.status !== 429 && err.status < 500) {
        throw err;
      }
      lastError = err;
    }

    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }

  throw lastError instanceof Error
    ? lastError
    : new EspnApiError("ESPN request failed", 0, path);
}

async function readError(
  res: Response,
): Promise<{ message: string | null; type: string | null }> {
  try {
    const body = (await res.json()) as EspnErrorResponse;
    const first = body.details?.[0];
    return {
      message: first?.message ?? body.messages?.[0] ?? null,
      type: first?.type ?? null,
    };
  } catch {
    return { message: null, type: null };
  }
}

export const espn = {
  /**
   * Every player ESPN knows about for a season, team defenses included.
   * ~2.3MB and ~11.6k rows — a sync-job call, never a request-path one.
   */
  getPlayerUniverse: (season: string) =>
    fetchJson<EspnPlayer[]>(
      `/seasons/${encodeURIComponent(season)}/players?scoringPeriodId=0&view=players_wl`,
      { filter: { players: { limit: PLAYER_FETCH_LIMIT } } },
    ),

  /** NFL teams as ESPN numbers them, with their bye weeks. */
  getProTeams: async (season: string): Promise<EspnProTeam[]> => {
    const res = await fetchJson<EspnSeasonResponse>(
      `/seasons/${encodeURIComponent(season)}?view=proTeamSchedules_wl`,
    );
    return res.settings?.proTeams ?? [];
  },

  /**
   * Every fantasy football league this account is in, for one season.
   *
   * ESPN has no "list my leagues" endpoint on the fantasy API, which is why
   * league ids started life as a hand-maintained env var — and why a league
   * joined after that list was written stayed invisible. The fan API does know,
   * so the list can maintain itself.
   *
   * Returns league ids as strings, to match how they are stored everywhere
   * else. Needs the same cookies as a private league read.
   */
  getMyLeagueIds: async (
    season: string,
    credentials: EspnCredentials | null,
  ): Promise<string[]> => {
    if (!credentials) return [];
    const res = await fetchJson<EspnFanResponse>(
      `/fans/${encodeURIComponent(credentials.swid)}?featureFlags=expandAthlete&displayEvents=false&displayNow=false&recUsage=false`,
      { baseUrl: FAN_BASE_URL, credentials },
    );

    const ids = new Set<string>();
    for (const pref of res.preferences ?? []) {
      const entry = pref.metaData?.entry;
      if (!entry) continue;
      // Most preferences are team or athlete follows; only FFL entries are ours.
      if ((entry.abbrev ?? "").toUpperCase() !== "FFL") continue;
      if (String(entry.seasonId ?? "") !== season) continue;
      for (const group of entry.groups ?? []) {
        if (group.groupId != null) ids.add(String(group.groupId));
      }
    }
    return [...ids];
  },

  /**
   * One league, in whichever views the caller needs.
   *
   * ESPN composes views rather than exposing separate resources, and the
   * combination matters: asking for several at once does not always return
   * what asking for each separately would. Callers therefore name the exact
   * set they want instead of getting a convenient default.
   *
   * Private leagues 401 without valid cookies — which is every league that has
   * not been deliberately made public.
   */
  getLeague: <T>(
    leagueId: string,
    season: string,
    views: string[],
    credentials: EspnCredentials | null,
    scoringPeriodId?: number,
  ): Promise<T> => {
    const params = views.map((v) => `view=${encodeURIComponent(v)}`);
    if (scoringPeriodId != null) params.unshift(`scoringPeriodId=${scoringPeriodId}`);
    return fetchJson<T>(
      `/seasons/${encodeURIComponent(season)}/segments/0/leagues/${encodeURIComponent(leagueId)}?${params.join("&")}`,
      { credentials },
    );
  },
};
