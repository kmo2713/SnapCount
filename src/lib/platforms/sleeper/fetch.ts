/**
 * Fans out the Sleeper calls needed to describe a league completely, and holds
 * the shared player-dump cache.
 */
import { sleeper } from "./client";
import type {
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeague,
  SleeperLeagueUser,
  SleeperMatchup,
  SleeperPlayerMap,
  SleeperRoster,
  SleeperState,
} from "./types";

/** Everything about one league, in raw wire format. */
export interface LeagueBundle {
  league: SleeperLeague;
  users: SleeperLeagueUser[];
  rosters: SleeperRoster[];
  matchupsByWeek: Map<number, SleeperMatchup[]>;
  draft: SleeperDraft | null;
  draftPicks: SleeperDraftPick[];
}

/**
 * Which week the dashboard should show.
 *
 * Sleeper reports a week during preseason too (`season_type: "pre"`), but those
 * weeks have no fantasy scoring, so we pin to week 1 until the regular season
 * actually starts rather than showing an empty week 3.
 */
export function resolveViewedWeek(state: SleeperState): number {
  if (state.season_type === "regular" || state.season_type === "post") {
    return Math.min(Math.max(state.week, 1), 18);
  }
  return 1;
}

/** True once real games are being played. */
export function isInSeason(state: SleeperState): boolean {
  return state.season_type === "regular" || state.season_type === "post";
}

interface FetchLeagueOptions {
  /** Weeks of matchups to pull. Defaults to just the viewed week. */
  weeks?: number[];
  /** Skip the two draft calls when the caller does not need them. */
  includeDraft?: boolean;
}

/**
 * Pulls one league's league/users/rosters/matchups (+ optionally its draft).
 * Matchup weeks are fetched concurrently; the client's own gate keeps the
 * request count polite.
 */
export async function fetchLeagueBundle(
  leagueId: string,
  { weeks = [], includeDraft = false }: FetchLeagueOptions = {},
): Promise<LeagueBundle | null> {
  const [league, users, rosters] = await Promise.all([
    sleeper.getLeague(leagueId),
    sleeper.getLeagueUsers(leagueId),
    sleeper.getRosters(leagueId),
  ]);

  if (!league) return null;

  const matchupsByWeek = new Map<number, SleeperMatchup[]>();
  if (weeks.length > 0) {
    const results = await Promise.all(
      weeks.map(async (week) => ({
        week,
        matchups: await sleeper.getMatchups(leagueId, week),
      })),
    );
    for (const { week, matchups } of results) {
      // A league that has not reached this week returns an empty array.
      if (matchups && matchups.length > 0) matchupsByWeek.set(week, matchups);
    }
  }

  let draft: SleeperDraft | null = null;
  let draftPicks: SleeperDraftPick[] = [];
  if (includeDraft && league.draft_id) {
    const drafts = await sleeper.getDrafts(leagueId);
    // A league can hold several drafts (startup + rookie); take the latest.
    draft =
      drafts?.find((d) => d.draft_id === league.draft_id) ??
      drafts?.[0] ??
      null;
    if (draft && draft.status !== "pre_draft") {
      draftPicks = (await sleeper.getDraftPicks(draft.draft_id)) ?? [];
    }
  }

  return {
    league,
    users: users ?? [],
    rosters: rosters ?? [],
    matchupsByWeek,
    draft,
    draftPicks,
  };
}

/* -------------------------------------------------------------------------
   Player dump cache
   ------------------------------------------------------------------------- */

/**
 * The /players/nfl dump is ~15MB and Sleeper asks that it be pulled at most
 * once a day. In live mode (no Postgres) we hold it in the server process and
 * refresh on a TTL, so page loads after the first are cheap.
 */
const PLAYER_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const globalForPlayers = globalThis as unknown as {
  snapCountPlayers?: { map: SleeperPlayerMap; fetchedAt: number };
  snapCountPlayersInFlight?: Promise<SleeperPlayerMap>;
};

export async function getPlayerMap(force = false): Promise<SleeperPlayerMap> {
  const cached = globalForPlayers.snapCountPlayers;
  if (!force && cached && Date.now() - cached.fetchedAt < PLAYER_CACHE_TTL_MS) {
    return cached.map;
  }

  // Collapse concurrent cold-start requests onto one download.
  if (!force && globalForPlayers.snapCountPlayersInFlight) {
    return globalForPlayers.snapCountPlayersInFlight;
  }

  const promise = (async () => {
    const map = await sleeper.getAllPlayers();
    if (!map) throw new Error("Sleeper returned no player data");
    globalForPlayers.snapCountPlayers = { map, fetchedAt: Date.now() };
    return map;
  })();

  globalForPlayers.snapCountPlayersInFlight = promise;
  try {
    return await promise;
  } finally {
    globalForPlayers.snapCountPlayersInFlight = undefined;
  }
}
