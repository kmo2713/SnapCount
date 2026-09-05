/**
 * Live NFL scores, one request for the whole slate.
 *
 * ESPN's public scoreboard endpoint — no auth, no key, the same host
 * `schedule.ts` already reads bye weeks from, and a different thing entirely
 * from the cookie-gated fantasy API in `platforms/espn/`.
 *
 * One call returns every game with score, clock, possession and a red-zone
 * flag, which is what makes a whole-slate view affordable to poll: ~135KB and
 * ~300ms for 16 games, against ~600-830KB *per game* for the box score and
 * play-by-play endpoints. Those belong to the drill-in, one game at a time.
 *
 * Deliberately not cached. Everything else that reads ESPN here sets a
 * revalidate window, but Next's data cache is stale-while-revalidate: the first
 * request past the window is served the *old* value while a refresh happens
 * behind it. For bye weeks that is free; for a live score it means showing a
 * touchdown late, which is the one thing this view cannot do. Concurrent polls
 * are collapsed in-process by the caller instead — see `data/gameday.ts`.
 */
import type { NflGame, NflGameSituation, NflGameTeam } from "@/lib/domain/gameday";
import { normalizeEspnAbbr } from "./schedule";

const SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/* -------------------------------------------------------------------------
   The subset of ESPN's payload we read

   Typed narrowly on purpose, the way `schedule.ts` does: the real response
   carries odds, pickcenter, headlines and highlights we have no use for, and
   declaring only what we read means an upstream addition cannot break the
   build. Everything is optional because this endpoint is undocumented and
   nothing in it is contractually guaranteed.
   ------------------------------------------------------------------------- */

interface EspnCompetitorRecord {
  type?: string;
  summary?: string;
}

interface EspnCompetitor {
  /** Equal to `team.id` in every payload observed; either resolves possession. */
  id?: string;
  homeAway?: string;
  /** A string, and "0" before kickoff — which is not the same as no score. */
  score?: string;
  records?: EspnCompetitorRecord[];
  team?: {
    id?: string;
    abbreviation?: string;
    displayName?: string;
    shortDisplayName?: string;
  };
}

/**
 * Present only while a game is in progress.
 *
 * `possession` is a *team id*, not an abbreviation — the one field here that
 * needs resolving against the competitor list rather than reading straight
 * through.
 *
 * Unverified shape. A completed game carries no `situation` at all (checked:
 * 0 of 16 on a finished slate), so this cannot be validated against historical
 * data — only against a game that is actually being played. Every field is
 * therefore optional and every reader tolerates absence. Confirm against the
 * Wed Sep 9 opener before trusting the red-zone radar.
 */
interface EspnSituation {
  downDistanceText?: string;
  shortDownDistanceText?: string;
  possession?: string;
  isRedZone?: boolean;
  lastPlay?: { text?: string };
}

interface EspnStatus {
  displayClock?: string;
  period?: number;
  type?: {
    state?: string;
    detail?: string;
    shortDetail?: string;
    completed?: boolean;
  };
}

interface EspnCompetition {
  competitors?: EspnCompetitor[];
  situation?: EspnSituation;
  broadcast?: string;
  broadcasts?: Array<{ names?: string[] }>;
}

interface EspnEvent {
  id?: string;
  date?: string;
  shortName?: string;
  name?: string;
  status?: EspnStatus;
  competitions?: EspnCompetition[];
}

export interface EspnScoreboardResponse {
  week?: { number?: number };
  events?: EspnEvent[];
}

/* -------------------------------------------------------------------------
   Normalisation
   ------------------------------------------------------------------------- */

/** ESPN's `state` is already our vocabulary; anything unexpected reads as pre. */
function gameState(state: string | undefined): NflGame["state"] {
  return state === "in" || state === "post" ? state : "pre";
}

/**
 * A competitor's score, or null before kickoff.
 *
 * ESPN reports "0" pregame, and rendering that as a real zero would say a team
 * has been held scoreless when in fact nobody has played. `fmt` renders null as
 * an em dash, which is the honest version.
 */
function score(raw: string | undefined, state: NflGame["state"]): number | null {
  if (state === "pre") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** The overall W-L, not the home/road splits ESPN ships alongside it. */
function overallRecord(records: EspnCompetitorRecord[] | undefined): string | null {
  const overall = records?.find((r) => r.type === "total");
  return overall?.summary?.trim() || null;
}

function team(
  competitor: EspnCompetitor | undefined,
  state: NflGame["state"],
): NflGameTeam {
  const abbr = competitor?.team?.abbreviation?.trim() ?? "";
  return {
    // Normalised so these join to `players.nflTeam`. Keyed on ESPN's own
    // spelling, Washington's players would fail to match at all.
    abbr: abbr ? normalizeEspnAbbr(abbr) : "",
    name:
      competitor?.team?.shortDisplayName?.trim() ||
      competitor?.team?.displayName?.trim() ||
      abbr ||
      "Unknown",
    score: score(competitor?.score, state),
    record: overallRecord(competitor?.records),
  };
}

/**
 * The live-only half, or null when the game is not being played.
 *
 * Returns null rather than a half-populated object when ESPN gives us a
 * `situation` on a game that is not in progress, so a caller can treat
 * "has a situation" and "is live" as the same question.
 */
function situation(
  competition: EspnCompetition | undefined,
  status: EspnStatus | undefined,
  state: NflGame["state"],
): NflGameSituation | null {
  const raw = competition?.situation;
  if (!raw || state !== "in") return null;

  // `possession` is a team id; map it back to the abbreviation everything else
  // in this app is keyed on. Both `competitor.id` and `competitor.team.id`
  // carry it, so either match is accepted.
  let possession: string | null = null;
  if (raw.possession) {
    const owner = competition?.competitors?.find(
      (c) => c.id === raw.possession || c.team?.id === raw.possession,
    );
    const abbr = owner?.team?.abbreviation?.trim();
    possession = abbr ? normalizeEspnAbbr(abbr) : null;
  }

  return {
    clock: status?.displayClock?.trim() || "",
    period: status?.period ?? 0,
    downDistance:
      raw.downDistanceText?.trim() || raw.shortDownDistanceText?.trim() || null,
    possession,
    isRedZone: raw.isRedZone === true,
    lastPlay: raw.lastPlay?.text?.trim() || null,
  };
}

/** The network showing a game, when ESPN names one. */
function broadcast(competition: EspnCompetition | undefined): string | null {
  return (
    competition?.broadcast?.trim() ||
    competition?.broadcasts?.[0]?.names?.[0]?.trim() ||
    null
  );
}

/**
 * Turns a scoreboard payload into `NflGame[]`.
 *
 * Pure and exported so it can be tested against a captured payload without a
 * network call — the only way to cover the shapes that matter here, since a
 * live game cannot be summoned on demand.
 *
 * An event missing an id is dropped: everything downstream keys on it, and a
 * game we cannot address is worse than a game we do not show.
 */
export function normalizeScoreboard(payload: EspnScoreboardResponse): {
  games: NflGame[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const games: NflGame[] = [];
  let dropped = 0;

  for (const event of payload.events ?? []) {
    if (!event.id) {
      dropped++;
      continue;
    }

    const competition = event.competitions?.[0];
    const state = gameState(event.status?.type?.state);
    const competitors = competition?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home") ?? competitors[0];
    const away = competitors.find((c) => c.homeAway === "away") ?? competitors[1];

    games.push({
      eventId: event.id,
      shortName: event.shortName?.trim() || event.name?.trim() || "",
      kickoff: event.date ?? "",
      state,
      statusDetail:
        event.status?.type?.shortDetail?.trim() ||
        event.status?.type?.detail?.trim() ||
        "",
      home: team(home, state),
      away: team(away, state),
      situation: situation(competition, event.status, state),
      broadcast: broadcast(competition),
    });
  }

  if (dropped > 0) {
    warnings.push(`${dropped} NFL game(s) had no event id and were skipped.`);
  }

  // Kickoff order, so the slate reads the way the day happens.
  games.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  return { games, warnings };
}

/* -------------------------------------------------------------------------
   Fetch
   ------------------------------------------------------------------------- */

/**
 * The week's games.
 *
 * Addressed by season and week rather than by date on purpose: a Sunday slate
 * spans two UTC dates once the late games start, so a date-keyed request drops
 * half the evening.
 *
 * Throws on a failed request rather than returning empty — the caller decides
 * whether an unreachable scoreboard degrades the page or fails it, and
 * `data/gameday.ts` degrades to the last known good payload.
 */
export async function fetchScoreboard(
  season: string,
  week: number,
): Promise<{ games: NflGame[]; warnings: string[] }> {
  const url = `${SCOREBOARD_URL}?dates=${encodeURIComponent(season)}&seasontype=2&week=${week}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // See the file header: never the data cache for live scores.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`ESPN scoreboard responded ${res.status}`);
  }

  return normalizeScoreboard((await res.json()) as EspnScoreboardResponse);
}
