/**
 * The drill-in loader: one game, marked up with who on the field is yours.
 *
 * The markup is the entire point. ESPN's box score is the same box score
 * everyone gets; what makes it worth opening here is that your starters and
 * your opponents' are picked out of it across all nine leagues at once — and
 * that the play feed can say a catch helped you in two leagues while hurting
 * you in a third. No single-league app can tell you that.
 *
 * Memoised per event on the same terms as the poll payload: short TTL, held in
 * process, never Next's data cache.
 */
import { and, eq, inArray } from "drizzle-orm";

import { requireDb, schema } from "@/lib/db/client";
import type { GameDetail } from "@/lib/domain/gameday";
import { env } from "@/lib/env";
import { espn } from "@/lib/platforms/espn/client";
import {
  fetchGameDetail,
  fetchPlayFeed,
  type PlayerLeagueRole,
  type RosterMarks,
} from "@/lib/platforms/nfl/gamefeed";
import { normalizeEspnAbbr } from "@/lib/platforms/nfl/schedule";
import { sleeper } from "@/lib/platforms/sleeper/client";
import { resolveViewedWeek } from "@/lib/platforms/sleeper/fetch";

const { leagues, matchups, playerAliases, rosterSlots, teams } = schema;

const MEMO_TTL_MS = 15_000;

/**
 * How many games are held open at once.
 *
 * The map is keyed by an id that arrives in the URL, so without a cap a caller
 * who varies it pins one GameDetail per distinct id, forever. Nobody has more
 * than a slate open at a time, so a slate is the bound.
 */
const DETAIL_MAX_KEYS = 20;

const globalForDetail = globalThis as unknown as {
  snapCountGameDetail?: Map<string, { detail: GameDetail; builtAt: number }>;
};

/** Everything the drill-in needs that does not change during a game. */
interface DrillInContext {
  marks: RosterMarks;
  /** Canonical player id -> every league you have a stake in them through. */
  roles: Map<string, PlayerLeagueRole[]>;
  /** ESPN numeric team id -> abbreviation, for resolving play team refs. */
  teamAbbrById: Map<string, string>;
}

/**
 * Rebuilt on a longer cycle than the game itself, because rosters do not
 * change mid-drive. Held for five minutes so opening six games in a row costs
 * one set of queries rather than six.
 */
const CONTEXT_TTL_MS = 5 * 60_000;

const globalForContext = globalThis as unknown as {
  snapCountDrillInContext?: { key: string; context: DrillInContext; builtAt: number };
};

async function drillInContext(season: string, week: number): Promise<DrillInContext> {
  const key = `${season}:${week}`;
  const cached = globalForContext.snapCountDrillInContext;
  if (cached && cached.key === key && Date.now() - cached.builtAt < CONTEXT_TTL_MS) {
    return cached.context;
  }

  const db = requireDb();

  const leagueRows = await db
    .select({ id: leagues.id, name: leagues.name })
    .from(leagues)
    .where(eq(leagues.season, season));

  const mine = new Set<string>();
  const against = new Set<string>();
  const roles = new Map<string, PlayerLeagueRole[]>();

  if (leagueRows.length > 0) {
    const leagueIds = leagueRows.map((l) => l.id);
    const leagueNameById = new Map(leagueRows.map((l) => [l.id, l.name]));

    const teamRows = await db
      .select({ id: teams.id, leagueId: teams.leagueId, isMine: teams.isMine })
      .from(teams)
      .where(inArray(teams.leagueId, leagueIds));

    const myTeamIds = teamRows.filter((t) => t.isMine).map((t) => t.id);

    // Only the teams actually facing you this week count as "against" — a
    // player on some other team in your league is not playing against you.
    const opponentIds: string[] = [];
    if (myTeamIds.length > 0) {
      const matchupRows = await db
        .select({ opponentTeamId: matchups.opponentTeamId })
        .from(matchups)
        .where(and(inArray(matchups.teamId, myTeamIds), eq(matchups.week, week)));
      for (const row of matchupRows) {
        if (row.opponentTeamId) opponentIds.push(row.opponentTeamId);
      }
    }

    const relevant = [...myTeamIds, ...opponentIds];
    if (relevant.length > 0) {
      const slotRows = await db
        .select({ teamId: rosterSlots.teamId, playerId: rosterSlots.playerId })
        .from(rosterSlots)
        .where(
          and(inArray(rosterSlots.teamId, relevant), eq(rosterSlots.kind, "starter")),
        );

      const myTeamSet = new Set(myTeamIds);
      const leagueByTeam = new Map(teamRows.map((t) => [t.id, t.leagueId]));

      for (const row of slotRows) {
        const isMine = myTeamSet.has(row.teamId);
        if (isMine) mine.add(row.playerId);
        else against.add(row.playerId);

        const leagueId = leagueByTeam.get(row.teamId);
        if (!leagueId) continue;

        /*
         * A player can appear more than once for the same side — you might
         * start him in three leagues — and the feed wants each of those named,
         * because "helps you in three leagues" is a different sentence from
         * "helps you".
         */
        const list = roles.get(row.playerId) ?? [];
        list.push({
          leagueId,
          leagueName: leagueNameById.get(leagueId) ?? "",
          side: isMine ? "mine" : "against",
        });
        roles.set(row.playerId, list);
      }
    }
  }

  const canonicalId = new Map<string, string>();
  const aliasRows = await db
    .select({
      platformPlayerId: playerAliases.platformPlayerId,
      playerId: playerAliases.playerId,
    })
    .from(playerAliases)
    .where(eq(playerAliases.platform, "espn"));
  for (const row of aliasRows) canonicalId.set(row.platformPlayerId, row.playerId);

  /*
   * Plays reference their team by URL rather than by abbreviation, so this maps
   * ESPN's numeric team ids back. Public, unauthenticated and effectively
   * static — it exists only to put "GB" in front of a play instead of "9".
   */
  const teamAbbrById = new Map<string, string>();
  try {
    for (const team of await espn.getProTeams(season)) {
      if (team.id != null && team.abbrev) {
        teamAbbrById.set(String(team.id), normalizeEspnAbbr(team.abbrev));
      }
    }
  } catch {
    // Cosmetic only: without it a play shows no team badge and nothing else
    // changes, so this must never fail the drill-in.
  }

  const context: DrillInContext = {
    marks: { mine, against, canonicalId },
    roles,
    teamAbbrById,
  };
  globalForContext.snapCountDrillInContext = { key, context, builtAt: Date.now() };
  return context;
}

export async function loadGameDetail(eventId: string): Promise<GameDetail> {
  /*
   * Length-bounded as well as digits-only. Real ESPN event ids are nine or ten
   * digits; without an upper bound the key space is infinite, and the only
   * thing limiting what gets cached is whether ESPN happens to 404 — an
   * upstream error behaviour is not a memory bound of ours.
   */
  if (!/^\d{6,12}$/.test(eventId)) throw new Error("eventId must be a valid event id");

  // Shape-checked for the same reason as the poll memo: globalThis outlives a
  // reload, and a truthy value of the wrong shape would survive `??=`.
  const existing = globalForDetail.snapCountGameDetail;
  const store =
    existing instanceof Map
      ? existing
      : (globalForDetail.snapCountGameDetail = new Map());
  const cached = store.get(eventId);
  if (cached && Date.now() - cached.builtAt < MEMO_TTL_MS) return cached.detail;

  const state = await sleeper.getState();
  const season = env.season ?? state?.league_season ?? state?.season ?? "";
  const week = state ? resolveViewedWeek(state) : 1;

  const context = await drillInContext(season, week);

  /*
   * Summary and plays in parallel — two different hosts, and the box score
   * should not wait on the play feed. The feed is allowed to fail on its own:
   * it is the newer and more speculative of the two, and a drill-in without it
   * is still a box score.
   */
  const [detail, plays] = await Promise.all([
    fetchGameDetail(eventId, context.marks),
    fetchPlayFeed(
      eventId,
      context.roles,
      context.marks.canonicalId,
      context.teamAbbrById,
    ).catch(() => null),
  ]);

  const withPlays: GameDetail = {
    ...detail,
    plays: plays ?? [],
    warnings:
      plays === null
        ? [...detail.warnings, "Play feed unavailable for this game."]
        : detail.warnings,
  };

  store.set(eventId, { detail: withPlays, builtAt: Date.now() });

  // Drop what has expired, then the oldest, until the map is within its cap.
  for (const [key, entry] of store) {
    if (Date.now() - entry.builtAt >= MEMO_TTL_MS) store.delete(key);
  }
  while (store.size > DETAIL_MAX_KEYS) {
    const oldest = [...store.entries()].sort((a, b) => a[1].builtAt - b[1].builtAt)[0];
    if (!oldest) break;
    store.delete(oldest[0]);
  }

  return withPlays;
}
