/**
 * NFL bye weeks.
 *
 * Sleeper's player dump has no bye-week field, and the prototype hardcoded a
 * made-up map. ESPN's public scoreboard endpoint (no auth, no key — a different
 * thing entirely from the cookie-gated fantasy API) reports `week.teamsOnBye`
 * for each regular-season week, so real byes come from there.
 *
 * 18 requests per season, so this is a sync-job concern, never a request-path
 * one. Callers get an empty map rather than an error if ESPN is unreachable —
 * the Bye Weeks view then renders its "not available" state instead of lying.
 */

const SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** Regular season is 18 weeks; byes never fall outside weeks 4-14. */
const REGULAR_SEASON_WEEKS = 18;

interface EspnScoreboardResponse {
  week?: {
    number?: number;
    teamsOnBye?: Array<{ abbreviation?: string; displayName?: string }>;
  };
}

/** Maps NFL team abbreviation -> bye week for a season. */
export type ByeWeekMap = Record<string, number>;

/**
 * ESPN and Sleeper disagree on a handful of abbreviations. Normalise to
 * Sleeper's spelling, since that is what our player rows carry.
 *
 * Washington is the only live disagreement, and it is not cosmetic: keyed on
 * ESPN's spelling, that team's players and defense fail to join to ours at all.
 * Shared with the ESPN fantasy client so both consumers of ESPN's spelling
 * agree on the answer.
 */
const ESPN_TO_SLEEPER_ABBR: Record<string, string> = {
  WSH: "WAS",
  LAR: "LAR",
  LAC: "LAC",
  JAX: "JAX",
};

export function normalizeEspnAbbr(abbr: string): string {
  return ESPN_TO_SLEEPER_ABBR[abbr] ?? abbr;
}

/**
 * Fetches every regular-season week and records which teams were idle.
 * Weeks that fail are skipped, so a partial map is still returned.
 */
export async function fetchByeWeeks(season: string): Promise<ByeWeekMap> {
  const byes: ByeWeekMap = {};

  const results = await Promise.allSettled(
    Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => i + 1).map(
      async (week) => {
        const url = `${SCOREBOARD_URL}?dates=${season}&seasontype=2&week=${week}`;
        const res = await fetch(url, {
          headers: { accept: "application/json" },
          next: { revalidate: 86_400 },
        });
        if (!res.ok) throw new Error(`ESPN responded ${res.status} for week ${week}`);
        const json = (await res.json()) as EspnScoreboardResponse;
        return { week, teams: json.week?.teamsOnBye ?? [] };
      },
    ),
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const team of result.value.teams) {
      if (!team.abbreviation) continue;
      byes[normalizeEspnAbbr(team.abbreviation)] = result.value.week;
    }
  }

  return byes;
}

/** The distinct weeks that have at least one team on bye, ascending. */
export function byeWeekList(byes: ByeWeekMap): number[] {
  return [...new Set(Object.values(byes))].sort((a, b) => a - b);
}
