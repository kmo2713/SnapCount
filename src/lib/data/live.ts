/**
 * Live loader: builds the dashboard straight from the Sleeper API, no Postgres.
 *
 * This is the fallback path when DATABASE_URL is not set, and the safety net
 * when the cache is empty. It works, but every cold page load pays for the
 * full fan-out, which is exactly why the Postgres cache exists.
 */
import type {
  DashboardData,
  DraftView,
  MyTeam,
  NflStateView,
  TrendingPlayer,
} from "@/lib/domain/types";
import { env } from "@/lib/env";
import { byeWeekList, fetchByeWeeks, type ByeWeekMap } from "@/lib/platforms/nfl/schedule";
import { sleeper } from "@/lib/platforms/sleeper/client";
import {
  fetchLeagueBundle,
  getPlayerMap,
  isInSeason,
  resolveViewedWeek,
  type LeagueBundle,
} from "@/lib/platforms/sleeper/fetch";
import {
  buildMyTeam,
  lookupFromSleeperPlayers,
  toPlayerFacts,
} from "@/lib/platforms/sleeper/normalize";
import { projectedPoints, type ProjectionSource } from "@/lib/domain/scoring";

/** Bye weeks change once a year; hold them for the process lifetime + TTL. */
const BYE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const globalForByes = globalThis as unknown as {
  snapCountByes?: { season: string; map: ByeWeekMap; fetchedAt: number };
};

async function getByeWeeks(season: string): Promise<ByeWeekMap> {
  const cached = globalForByes.snapCountByes;
  if (
    cached &&
    cached.season === season &&
    Date.now() - cached.fetchedAt < BYE_CACHE_TTL_MS
  ) {
    return cached.map;
  }
  try {
    const map = await fetchByeWeeks(season);
    globalForByes.snapCountByes = { season, map, fetchedAt: Date.now() };
    return map;
  } catch {
    // ESPN being down must not take the dashboard with it.
    return cached?.map ?? {};
  }
}

/**
 * Projections are ~2.8MB per week — too big for Next's data cache, so they are
 * memoised in-process instead. Short TTL because projections genuinely move
 * during the week as injury news lands.
 */
const PROJECTION_CACHE_TTL_MS = 15 * 60 * 1000;
const globalForProjections = globalThis as unknown as {
  snapCountProjections?: {
    key: string;
    sources: Map<string, ProjectionSource>;
    fetchedAt: number;
  };
};

async function getProjectionSources(
  season: string,
  week: number,
): Promise<Map<string, ProjectionSource>> {
  const key = `${season}:${week}`;
  const cached = globalForProjections.snapCountProjections;
  if (
    cached &&
    cached.key === key &&
    Date.now() - cached.fetchedAt < PROJECTION_CACHE_TTL_MS
  ) {
    return cached.sources;
  }

  const sources = new Map<string, ProjectionSource>();
  try {
    const rows = await sleeper.getProjections(season, week);
    for (const row of rows ?? []) {
      if (!row.stats) continue;
      sources.set(row.player_id, {
        stats: row.stats,
        ptsPpr: row.stats.pts_ppr ?? null,
        ptsHalfPpr: row.stats.pts_half_ppr ?? null,
        ptsStd: row.stats.pts_std ?? null,
      });
    }
  } catch {
    // Undocumented endpoint — degrade to no projections, keep the last good set.
    return cached?.sources ?? sources;
  }

  globalForProjections.snapCountProjections = {
    key,
    sources,
    fetchedAt: Date.now(),
  };
  return sources;
}

export interface LoadOptions {
  /** Override the week to display. Defaults to the current NFL week. */
  week?: number;
  /** Override the season. Defaults to SNAP_COUNT_SEASON or Sleeper's state. */
  season?: string;
  /** Pull draft picks too — a couple of extra calls per league. */
  includeDrafts?: boolean;
}

export async function loadDashboardLive(
  options: LoadOptions = {},
): Promise<DashboardData> {
  const warnings: string[] = [];

  const state = await sleeper.getState();
  if (!state) throw new Error("Could not reach Sleeper's /state/nfl endpoint");

  const season = options.season ?? env.season ?? state.league_season ?? state.season;
  const viewedWeek = options.week ?? resolveViewedWeek(state);

  const stateView: NflStateView = {
    season,
    seasonType: state.season_type,
    week: state.week,
    displayWeek: state.display_week,
    inSeason: isInSeason(state),
  };

  const user = await sleeper.getUser(env.sleeperUsername);
  if (!user) {
    throw new Error(
      `Sleeper has no user named "${env.sleeperUsername}". Check SLEEPER_USERNAME.`,
    );
  }

  const leagues = await sleeper.getLeagues(user.user_id, season);
  if (!leagues || leagues.length === 0) {
    return {
      state: stateView,
      viewedWeek,
      teams: [],
      trending: [],
      drafts: [],
      byeWeeks: {},
      lastSyncedAt: new Date().toISOString(),
      source: "live",
      warnings: [`No Sleeper leagues found for ${env.sleeperUsername} in ${season}.`],
    };
  }

  // Weeks 1..viewedWeek gives the charts view a scoring history for free.
  const weeks = Array.from({ length: viewedWeek }, (_, i) => i + 1);

  const [playerMap, byeWeeks, projectionSources, bundles] = await Promise.all([
    getPlayerMap(),
    getByeWeeks(season),
    getProjectionSources(season, viewedWeek),
    Promise.all(
      leagues.map(async (l) => {
        try {
          return await fetchLeagueBundle(l.league_id, {
            weeks,
            includeDraft: options.includeDrafts ?? true,
          });
        } catch (err) {
          warnings.push(
            `Could not load "${l.name.trim()}": ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }
      }),
    ),
  ]);

  const lookup = lookupFromSleeperPlayers(playerMap);

  if (projectionSources.size === 0) {
    warnings.push(
      `No projections available for ${season} week ${viewedWeek}.`,
    );
  }

  const teams: MyTeam[] = [];
  const drafts: DraftView[] = [];

  for (const bundle of bundles) {
    if (!bundle) continue;
    // Score every projection against this league’s own settings, so a
    // half-PPR league and a full-PPR league see different numbers.
    const scoring = bundle.league.scoring_settings ?? null;
    const projections = new Map<string, number | null>();
    for (const [playerId, source] of projectionSources) {
      projections.set(playerId, projectedPoints(source, scoring));
    }

    const team = buildMyTeam({
      league: bundle.league,
      users: bundle.users,
      rosters: bundle.rosters,
      matchupsByWeek: bundle.matchupsByWeek,
      viewedWeek,
      myUserId: user.user_id,
      lookup,
      byeWeeks,
      projections,
    });
    if (!team) {
      warnings.push(`No roster owned by you in "${bundle.league.name.trim()}".`);
      continue;
    }
    teams.push(team);

    const draftView = buildDraftView(bundle, playerMap);
    if (draftView) drafts.push(draftView);
  }

  teams.sort((a, b) => a.leagueName.localeCompare(b.leagueName));

  const trending = await loadTrending(playerMap, teams);

  return {
    state: stateView,
    viewedWeek,
    teams,
    trending,
    drafts,
    byeWeeks,
    lastSyncedAt: new Date().toISOString(),
    source: "live",
    warnings,
  };
}

/** Assembles a draft recap from a bundle's picks. */
function buildDraftView(
  bundle: LeagueBundle,
  playerMap: Record<string, import("@/lib/platforms/sleeper/types").SleeperPlayer>,
): DraftView | null {
  if (!bundle.draft || bundle.draftPicks.length === 0) return null;

  const userById = new Map(bundle.users.map((u) => [u.user_id, u]));
  const rosterById = new Map(bundle.rosters.map((r) => [r.roster_id, r]));

  const picks = [...bundle.draftPicks]
    .sort((a, b) => a.pick_no - b.pick_no)
    .map((p) => {
      const raw = p.player_id ? playerMap[p.player_id] : undefined;
      const facts = raw ? toPlayerFacts(raw) : null;
      // Sleeper embeds a name snapshot in metadata, useful for retired players
      // who have since dropped out of the active player dump.
      const metaName = [p.metadata?.first_name, p.metadata?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();

      const owner = p.picked_by ? userById.get(p.picked_by) : undefined;
      const roster = p.roster_id != null ? rosterById.get(p.roster_id) : undefined;
      const rosterOwner = roster?.owner_id
        ? userById.get(roster.owner_id)
        : undefined;
      const pickedBy =
        owner?.metadata?.team_name?.trim() ||
        owner?.display_name ||
        rosterOwner?.metadata?.team_name?.trim() ||
        rosterOwner?.display_name ||
        (p.roster_id != null ? `Roster ${p.roster_id}` : "—");

      return {
        pickNo: p.pick_no,
        round: p.round,
        draftSlot: p.draft_slot ?? null,
        playerId: p.player_id,
        playerName: facts?.fullName || metaName || p.player_id || "—",
        position: facts?.position || p.metadata?.position || "—",
        nflTeam: facts?.nflTeam || p.metadata?.team || "",
        pickedBy,
        isKeeper: Boolean(p.is_keeper),
      };
    });

  return {
    leagueId: `sleeper-${bundle.league.league_id}`,
    leagueName: bundle.league.name.trim(),
    season: bundle.draft.season,
    status: bundle.draft.status,
    rounds: bundle.draft.settings?.rounds ?? null,
    picks,
  };
}

/** Trending adds, tagged with whether you already roster the player. */
export async function loadTrending(
  playerMap: Record<string, import("@/lib/platforms/sleeper/types").SleeperPlayer>,
  teams: MyTeam[],
  limit = 25,
): Promise<TrendingPlayer[]> {
  const raw = await sleeper.getTrending("add", 24, limit).catch(() => null);
  if (!raw) return [];

  const rostered = new Set<string>();
  for (const t of teams) for (const p of t.roster) rostered.add(p.id);

  return raw.map((row) => {
    const player = playerMap[row.player_id];
    const facts = player ? toPlayerFacts(player) : null;
    return {
      playerId: row.player_id,
      name: facts?.fullName ?? row.player_id,
      position: facts?.position ?? "—",
      nflTeam: facts?.nflTeam ?? "",
      count: row.count,
      rostered: rostered.has(row.player_id),
    };
  });
}

export { byeWeekList };
