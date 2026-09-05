/**
 * One game, in detail — the drill-in's feed.
 *
 * Split from `scoreboard.ts` because the cost profile is completely different.
 * The scoreboard is ~135KB for the whole slate and is polled; this is ~595KB
 * for a single game and is fetched only when someone opens it. Polling this
 * for eight concurrent games would be five megabytes a cycle, which is why the
 * drill-in is a deliberate act rather than something the wall does eagerly.
 *
 * The interesting part is the box score, because ESPN's athlete ids are the
 * same id space as its fantasy API's — verified against the crosswalk this app
 * already builds — so every line can be marked as yours or your opponent's
 * without matching on names.
 */
import type {
  BoxScoreCategory,
  GameState,
  PlayEvent,
  BoxScorePlayer,
  BoxScoreTeam,
  DriveSummary,
  GameDetail,
  ScoringPlay,
  WinProbabilityPoint,
} from "@/lib/domain/gameday";
import { normalizeEspnAbbr } from "./schedule";

const SUMMARY_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";

/* -- the subset we read; every field optional, as with the scoreboard -- */

interface EspnAthleteLine {
  athlete?: { id?: string; displayName?: string };
  stats?: string[];
}

interface EspnStatCategory {
  name?: string;
  labels?: string[];
  athletes?: EspnAthleteLine[];
}

interface EspnBoxTeam {
  team?: { abbreviation?: string };
  statistics?: EspnStatCategory[];
}

interface EspnScoringPlay {
  id?: string;
  text?: string;
  awayScore?: number;
  homeScore?: number;
  period?: { number?: number };
  clock?: { displayValue?: string };
  team?: { abbreviation?: string };
}

interface EspnDrive {
  id?: string;
  description?: string;
  result?: string;
  displayResult?: string;
  isScore?: boolean;
  offensivePlays?: number;
  team?: { abbreviation?: string };
  plays?: unknown[];
}

interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  team?: { abbreviation?: string; shortDisplayName?: string; displayName?: string };
  records?: Array<{ type?: string; summary?: string }>;
}

export interface EspnSummaryResponse {
  boxscore?: { players?: EspnBoxTeam[] };
  scoringPlays?: EspnScoringPlay[];
  drives?: { previous?: EspnDrive[]; current?: EspnDrive };
  winprobability?: Array<{ homeWinPercentage?: number }>;
  header?: {
    competitions?: Array<{
      status?: {
        displayClock?: string;
        period?: number;
        type?: { state?: string; shortDetail?: string; detail?: string };
      };
      competitors?: EspnCompetitor[];
    }>;
    shortLinkText?: string;
  };
}

/** Who to mark up in a box score. */
export interface RosterMarks {
  /** Canonical player ids you start somewhere. */
  mine: ReadonlySet<string>;
  /** Canonical player ids started by a team you face this week. */
  against: ReadonlySet<string>;
  /** ESPN athlete id -> canonical player id. */
  canonicalId: ReadonlyMap<string, string>;
}

function state(raw: string | undefined): GameState {
  return raw === "in" || raw === "post" ? raw : "pre";
}

function boxScore(payload: EspnSummaryResponse, marks: RosterMarks): BoxScoreTeam[] {
  const out: BoxScoreTeam[] = [];

  for (const team of payload.boxscore?.players ?? []) {
    const abbr = team.team?.abbreviation?.trim();
    const categories: BoxScoreCategory[] = [];

    for (const category of team.statistics ?? []) {
      const players: BoxScorePlayer[] = [];

      for (const line of category.athletes ?? []) {
        const espnId = line.athlete?.id;
        // The join that makes this view personal rather than generic. ESPN's
        // site ids and its fantasy ids are the same space, so the crosswalk
        // built by the ESPN sync resolves them directly.
        const playerId = espnId ? (marks.canonicalId.get(espnId) ?? null) : null;

        players.push({
          playerId,
          name: line.athlete?.displayName?.trim() || "Unknown",
          stats: line.stats ?? [],
          mine: playerId != null && marks.mine.has(playerId),
          against: playerId != null && marks.against.has(playerId),
        });
      }

      // A category nobody recorded a stat in is noise on a phone.
      if (players.length === 0) continue;

      categories.push({
        name: category.name?.trim() || "",
        labels: category.labels ?? [],
        players,
      });
    }

    out.push({ abbr: abbr ? normalizeEspnAbbr(abbr) : "", categories });
  }

  return out;
}

function scoringPlays(
  payload: EspnSummaryResponse,
  marks: RosterMarks,
  box: BoxScoreTeam[],
): ScoringPlay[] {
  /*
   * The summary's scoring plays carry prose and no participant ids — unlike
   * the core play-by-play endpoint, which does. Rather than pull another
   * 826KB just to flag a handful of plays, this matches the play text against
   * the names of players you start in this game. Name matching is exactly the
   * fragile thing avoided everywhere else, so it is confined to a cosmetic
   * highlight: being wrong here mis-colours a row, it never changes a number.
   */
  const myNames: string[] = [];
  for (const team of box) {
    for (const category of team.categories) {
      for (const player of category.players) {
        if (player.mine && player.name !== "Unknown") myNames.push(player.name);
      }
    }
  }

  return (payload.scoringPlays ?? []).map((play) => {
    const text = play.text?.trim() ?? "";
    return {
      id: play.id ?? "",
      text,
      team: play.team?.abbreviation ? normalizeEspnAbbr(play.team.abbreviation) : "",
      period: play.period?.number ?? 0,
      clock: play.clock?.displayValue?.trim() ?? "",
      awayScore: play.awayScore ?? 0,
      homeScore: play.homeScore ?? 0,
      involvesMine: myNames.some((name) => text.includes(name)),
    };
  });
}

function drives(payload: EspnSummaryResponse): DriveSummary[] {
  const all = [...(payload.drives?.previous ?? [])];
  if (payload.drives?.current) all.push(payload.drives.current);

  return all.map((drive, i) => ({
    id: drive.id ?? String(i),
    team: drive.team?.abbreviation ? normalizeEspnAbbr(drive.team.abbreviation) : "",
    result: drive.displayResult?.trim() || drive.result?.trim() || "",
    description: drive.description?.trim() ?? "",
    plays: drive.offensivePlays ?? drive.plays?.length ?? 0,
    isScore: drive.isScore === true,
  }));
}

function winProbability(payload: EspnSummaryResponse): WinProbabilityPoint[] {
  return (payload.winprobability ?? [])
    .map((point, index) => ({
      index,
      homeWinPercentage: point.homeWinPercentage ?? 0.5,
    }))
    .filter((p) => Number.isFinite(p.homeWinPercentage));
}

function competitor(
  payload: EspnSummaryResponse,
  side: "home" | "away",
): GameDetail["home"] {
  const competition = payload.header?.competitions?.[0];
  const found = competition?.competitors?.find((c) => c.homeAway === side);
  const abbr = found?.team?.abbreviation?.trim() ?? "";
  const raw = Number(found?.score);
  const gameState = state(competition?.status?.type?.state);

  return {
    abbr: abbr ? normalizeEspnAbbr(abbr) : "",
    name:
      found?.team?.shortDisplayName?.trim() ||
      found?.team?.displayName?.trim() ||
      abbr ||
      "Unknown",
    score: gameState === "pre" || !Number.isFinite(raw) ? null : raw,
    record: found?.records?.find((r) => r.type === "total")?.summary?.trim() ?? null,
  };
}

/** Turns a summary payload into the drill-in's view model. Pure. */
export function normalizeSummary(
  eventId: string,
  payload: EspnSummaryResponse,
  marks: RosterMarks,
): GameDetail {
  const competition = payload.header?.competitions?.[0];
  const gameState = state(competition?.status?.type?.state);
  const box = boxScore(payload, marks);
  const warnings: string[] = [];

  if (box.length === 0) {
    // Normal before kickoff; worth saying so rather than rendering a blank pane.
    warnings.push("No box score yet — this game has not started.");
  }

  const home = competitor(payload, "home");
  const away = competitor(payload, "away");

  return {
    eventId,
    shortName: payload.header?.shortLinkText?.trim() || `${away.abbr} @ ${home.abbr}`,
    state: gameState,
    statusDetail:
      competition?.status?.type?.shortDetail?.trim() ||
      competition?.status?.type?.detail?.trim() ||
      "",
    home,
    away,
    situation: null,
    boxScore: box,
    scoringPlays: scoringPlays(payload, marks, box),
    drives: drives(payload),
    winProbability: winProbability(payload),
    plays: [],
    warnings,
  };
}

/**
 * Fetches one game's detail.
 *
 * Uncached for the same reason the scoreboard is: the data cache is
 * stale-while-revalidate, and a box score that lags a drive behind is worse
 * than one that takes an extra 200ms.
 */
export async function fetchGameDetail(
  eventId: string,
  marks: RosterMarks,
): Promise<GameDetail> {
  // Digits only — this is interpolated into an upstream URL.
  if (!/^\d+$/.test(eventId)) {
    throw new Error("eventId must be numeric");
  }

  const res = await fetch(`${SUMMARY_URL}?event=${eventId}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`ESPN summary responded ${res.status}`);
  }

  return normalizeSummary(eventId, (await res.json()) as EspnSummaryResponse, marks);
}

/* -------------------------------------------------------------------------
   Play feed
   ------------------------------------------------------------------------- */

/**
 * Yards that make a play worth surfacing on its own.
 *
 * Ten is a first down on most snaps — enough to be the kind of play someone
 * would mention out loud, which is the bar the feed is aiming at.
 */
const CONSEQUENTIAL_YARDS = 10;

const PLAYS_URL = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";

/**
 * Where a player sits in one of your leagues.
 *
 * "mine" and "against" rather than a boolean because the same player is
 * regularly both — you start him in one league while your opponent starts him
 * in another, which is the exact situation this whole feature exists to
 * surface.
 */
export interface PlayerLeagueRole {
  leagueId: string;
  leagueName: string;
  side: "mine" | "against";
}

interface EspnCorePlay {
  id?: string;
  text?: string;
  shortText?: string;
  scoringPlay?: boolean;
  isTurnover?: boolean;
  statYardage?: number;
  period?: { number?: number };
  clock?: { displayValue?: string };
  team?: { $ref?: string };
  participants?: Array<{ athlete?: { $ref?: string }; type?: string }>;
}

/**
 * ESPN's core API returns references rather than ids, so the athlete id has to
 * come out of the `$ref` URL: `.../athletes/4047365?lang=en`. Fragile-looking,
 * but the path shape is stable across every payload observed, and the
 * alternative — one HTTP call per participant per play — is not a real option.
 */
export function athleteIdFromRef(ref: string | undefined): string | null {
  if (!ref) return null;
  const match = /\/athletes\/(\d+)/.exec(ref);
  return match ? match[1] : null;
}

/** Same trick for the team reference. */
function teamIdFromRef(ref: string | undefined): string | null {
  if (!ref) return null;
  const match = /\/teams\/(\d+)/.exec(ref);
  return match ? match[1] : null;
}

/**
 * Turns raw plays into a feed of only the ones you have a stake in.
 *
 * The filtering is the point. A game has ~190 plays and you might have two
 * players in it; a feed that shows all 190 is a play-by-play, which ESPN
 * already gives you for free. What it cannot give you is "that catch just
 * helped you in two leagues and hurt you in a third".
 */
export function normalizePlays(
  items: EspnCorePlay[],
  roles: ReadonlyMap<string, PlayerLeagueRole[]>,
  canonicalId: ReadonlyMap<string, string>,
  teamAbbrById: ReadonlyMap<string, string>,
): PlayEvent[] {
  const feed: PlayEvent[] = [];

  for (const play of items) {
    const involved: PlayEvent["involved"] = [];
    const seen = new Set<string>();

    for (const participant of play.participants ?? []) {
      const espnId = athleteIdFromRef(participant.athlete?.$ref);
      if (!espnId || seen.has(espnId)) continue;
      seen.add(espnId);

      const playerId = canonicalId.get(espnId);
      if (!playerId) continue;

      const playerRoles = roles.get(playerId);
      if (!playerRoles || playerRoles.length === 0) continue;

      involved.push({ playerId, espnId, roles: playerRoles });
    }

    if (involved.length === 0) continue;

    const teamId = teamIdFromRef(play.team?.$ref);
    const yards = typeof play.statYardage === "number" ? play.statYardage : null;

    feed.push({
      id: play.id ?? "",
      text: play.text?.trim() || play.shortText?.trim() || "",
      team: teamId ? (teamAbbrById.get(teamId) ?? "") : "",
      period: play.period?.number ?? 0,
      clock: play.clock?.displayValue?.trim() ?? "",
      scoringPlay: play.scoringPlay === true,
      yards,
      consequential:
        play.scoringPlay === true ||
        play.isTurnover === true ||
        (yards != null && yards >= CONSEQUENTIAL_YARDS),
      involved,
    });
  }

  // Newest first: a live feed is read from the top.
  return feed.reverse();
}

/**
 * Fetches and filters one game's plays.
 *
 * ~826KB for a finished game, which is why this is drill-in only and never
 * part of the poll. The filtering happens here rather than in the browser, so
 * what crosses the wire is a handful of plays instead of two hundred.
 */
export async function fetchPlayFeed(
  eventId: string,
  roles: ReadonlyMap<string, PlayerLeagueRole[]>,
  canonicalId: ReadonlyMap<string, string>,
  teamAbbrById: ReadonlyMap<string, string>,
): Promise<PlayEvent[]> {
  if (!/^\d+$/.test(eventId)) throw new Error("eventId must be numeric");

  const res = await fetch(
    `${PLAYS_URL}/events/${eventId}/competitions/${eventId}/plays?limit=400`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );

  if (!res.ok) throw new Error(`ESPN plays responded ${res.status}`);

  const body = (await res.json()) as { items?: EspnCorePlay[] };
  return normalizePlays(body.items ?? [], roles, canonicalId, teamAbbrById);
}
