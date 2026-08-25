/**
 * Turns a raw ESPN league response into the rows the cache stores.
 *
 * The fiddly parts of ESPN's format, all handled here so no view and no sync
 * job has to know about them:
 *
 *  - Rosters live on the *schedule*, not on the team. `mRoster` returns nothing
 *    for these leagues, so every roster is read out of
 *    `schedule[].home/away.rosterForCurrentScoringPeriod`.
 *  - The same team appears once per matchup period, so the schedule has to be
 *    reduced to "the roster as of the week we care about" rather than trusted
 *    row by row.
 *  - `lineupSlotId` is its own enumeration, unrelated to `defaultPositionId`.
 *  - Projections and actuals share one `stats` array, told apart by
 *    `statSourceId`. Both already have league scoring applied.
 */
import type { LeagueFormat } from "@/lib/domain/types";
import { BENCH_SLOTS, LINEUP_SLOT } from "./players";
import type {
  EspnLeagueResponse,
  EspnLeagueSettings,
  EspnMatchupSide,
  EspnRosterEntry,
  EspnTeam,
} from "./league-types";

/** ESPN's slot id for injured reserve. */
const IR_SLOT = 21;

/**
 * The league's lineup expressed the way Sleeper spells it, so that
 * `startingSlots()` and every view keep working unchanged.
 *
 * `lineupSlotCounts` is a map of slot id to count, which loses ordering — so
 * the result is sorted by slot id, which happens to put QB before RB before WR
 * and lands bench and IR at the end.
 */
export function rosterPositions(league: EspnLeagueResponse): string[] {
  const counts = league.settings?.rosterSettings?.lineupSlotCounts ?? {};
  const out: string[] = [];
  for (const [id, count] of Object.entries(counts).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  )) {
    const label = LINEUP_SLOT[Number(id)] ?? `SLOT_${id}`;
    for (let i = 0; i < (count ?? 0); i++) out.push(label);
  }
  return out;
}

/**
 * pre_draft | in_season | complete, in Sleeper's vocabulary.
 *
 * ESPN reports whether a draft has happened separately from whether the season
 * is live, and the dashboard only distinguishes "nothing has happened yet"
 * from everything else.
 */
export function leagueStatus(league: EspnLeagueResponse): string {
  if (league.draftDetail?.inProgress) return "drafting";
  if (league.draftDetail?.drafted === false) return "pre_draft";
  const status = league.status;
  if (
    status?.finalScoringPeriod != null &&
    status.latestScoringPeriod != null &&
    status.latestScoringPeriod > status.finalScoringPeriod
  ) {
    return "complete";
  }
  return "in_season";
}

/** ESPN names a team, or falls back the way its own UI does. */
export function teamName(team: EspnTeam): string {
  const name = team.name?.trim();
  if (name) return name;
  const abbrev = team.abbrev?.trim();
  if (abbrev) return abbrev;
  return `Team ${team.id}`;
}

/** True when the configured SWID owns this team. */
export function isMyTeam(team: EspnTeam, swid: string | null): boolean {
  if (!swid) return false;
  return (team.owners ?? []).some((o) => o.toUpperCase() === swid.toUpperCase());
}

/**
 * Team defenses are one player to ESPN and to us, but ESPN's roster entry
 * carries the numeric id while the universe carries the same one — so nothing
 * special is needed here beyond stringifying.
 */
export function espnPlayerKey(entry: EspnRosterEntry): string {
  return String(entry.playerId ?? entry.playerPoolEntry?.id ?? "");
}

export interface RosterSlotRow {
  espnPlayerId: string;
  kind: "starter" | "bench" | "ir";
  slotPosition: string;
  /** Position within the starting lineup, preserving league slot order. */
  slotIndex: number | null;
}

/**
 * One team's roster as of a scoring period.
 *
 * Starters are indexed in the league's own slot order rather than the order
 * ESPN happened to return them, so a QB is always index 0 and the FLEX always
 * lands where the league puts it. Without that, two teams in the same league
 * would render their lineups in different orders.
 */
export function rosterFor(
  entries: EspnRosterEntry[],
  leagueSlots: string[],
): RosterSlotRow[] {
  const starters = entries
    .filter((e) => !BENCH_SLOTS.has(e.lineupSlotId))
    .sort((a, b) => a.lineupSlotId - b.lineupSlotId);

  // Walk the league's declared starting slots and hand each one to the next
  // player ESPN put in that slot.
  const remaining = new Map<string, EspnRosterEntry[]>();
  for (const e of starters) {
    const label = LINEUP_SLOT[e.lineupSlotId] ?? `SLOT_${e.lineupSlotId}`;
    const list = remaining.get(label) ?? [];
    list.push(e);
    remaining.set(label, list);
  }

  const rows: RosterSlotRow[] = [];
  const placed = new Set<EspnRosterEntry>();

  leagueSlots.forEach((label, index) => {
    const next = remaining.get(label)?.shift();
    if (!next) return;
    placed.add(next);
    rows.push({
      espnPlayerId: espnPlayerKey(next),
      kind: "starter",
      slotPosition: label,
      slotIndex: index,
    });
  });

  // Anything ESPN starts that the league's slot list did not account for still
  // belongs in the lineup — better an unexpected slot than a vanished player.
  for (const e of starters) {
    if (placed.has(e)) continue;
    rows.push({
      espnPlayerId: espnPlayerKey(e),
      kind: "starter",
      slotPosition: LINEUP_SLOT[e.lineupSlotId] ?? `SLOT_${e.lineupSlotId}`,
      slotIndex: null,
    });
  }

  for (const e of entries) {
    if (!BENCH_SLOTS.has(e.lineupSlotId)) continue;
    rows.push({
      espnPlayerId: espnPlayerKey(e),
      kind: e.lineupSlotId === IR_SLOT ? "ir" : "bench",
      slotPosition: e.lineupSlotId === IR_SLOT ? "IR" : "BN",
      slotIndex: null,
    });
  }

  return rows;
}

/** Points a player actually scored in a week, league scoring applied. */
export function actualPoints(
  entry: EspnRosterEntry,
  week: number,
): number | null {
  return statFor(entry, week, 0);
}

/** Points a player was projected for in a week, league scoring applied. */
export function projectedPoints(
  entry: EspnRosterEntry,
  week: number,
): number | null {
  return statFor(entry, week, 1);
}

function statFor(
  entry: EspnRosterEntry,
  week: number,
  statSourceId: number,
): number | null {
  const stats = entry.playerPoolEntry?.player?.stats ?? [];
  const hit = stats.find(
    (s) =>
      s.statSourceId === statSourceId &&
      s.statSplitTypeId === 1 &&
      s.scoringPeriodId === week,
  );
  return hit?.appliedTotal ?? null;
}

/** The opponent of every team in a matchup period, plus that week's score. */
export interface MatchupPairing {
  teamId: number;
  opponentTeamId: number | null;
  matchupId: string | null;
  points: number | null;
  entries: EspnRosterEntry[];
}

export function pairingsFor(
  league: EspnLeagueResponse,
  matchupPeriod: number,
): MatchupPairing[] {
  const out: MatchupPairing[] = [];

  for (const m of league.schedule ?? []) {
    if (m.matchupPeriodId !== matchupPeriod) continue;
    const sides: Array<[EspnMatchupSide | undefined, EspnMatchupSide | undefined]> = [
      [m.home, m.away],
      [m.away, m.home],
    ];
    for (const [side, other] of sides) {
      if (!side) continue;
      out.push({
        teamId: side.teamId,
        opponentTeamId: other?.teamId ?? null,
        matchupId: m.id != null ? String(m.id) : null,
        /*
         * `pointsByScoringPeriod` carries an entry only for a period that has
         * actually scored, which makes its presence the honest test of whether
         * a week happened. `gamesPlayed` is not: it reads 0 even on a finished
         * week, and trusting it stored null for every completed 2025 matchup.
         */
        points: side.pointsByScoringPeriod?.[String(matchupPeriod)] ?? null,
        entries: side.rosterForCurrentScoringPeriod?.entries ?? [],
      });
    }
  }

  return out;
}

/**
 * How this league awards free agents, in the same shape the Sleeper path
 * returns.
 *
 * ESPN spells this `acquisitionType`, and both configured leagues report
 * WAIVERS_TRADITIONAL — a priority list, despite `acquisitionBudget` also
 * being present and set to 100. That budget means nothing in a priority
 * league, so it is only reported when the type actually says the league bids.
 *
 * Only WAIVERS_TRADITIONAL has been observed live, so the FAAB test is a
 * substring match rather than an exact one: an unrecognised type falls back to
 * priority, which shows a waiver position instead of inventing a budget.
 */
export function waiverRules(settings: EspnLeagueSettings | null | undefined): {
  mode: "faab" | "priority";
  budget: number | null;
} {
  const acquisition = settings?.acquisitionSettings;
  const type = (acquisition?.acquisitionType ?? "").toUpperCase();
  if (!type.includes("FAAB")) return { mode: "priority", budget: null };
  return {
    mode: "faab",
    budget:
      typeof acquisition?.acquisitionBudget === "number"
        ? acquisition.acquisitionBudget
        : null,
  };
}

/**
 * dynasty | keeper | redraft, from ESPN's draft settings.
 *
 * ESPN has no single "format" field, so this reads the keeper counts:
 * `keeperCount` is how many each team holds this season and
 * `keeperCountFuture` how many next, and a league that keeps nobody either way
 * is a redraft. `leagueSubType` is the closest thing to an explicit label and
 * reports NONE for both configured leagues, so it is only trusted when it
 * actually says something.
 *
 * Note that a *player* carrying `keeperValue` proves nothing — ESPN populates
 * that on rosters in plain redraft leagues too.
 */
export function leagueFormat(
  settings: EspnLeagueSettings | null | undefined,
): LeagueFormat | null {
  const draft = settings?.draftSettings;
  if (!draft) return null;

  const subType = (draft.leagueSubType ?? "").toUpperCase();
  if (subType.includes("DYNASTY")) return "dynasty";
  if (subType.includes("KEEPER")) return "keeper";

  const now = draft.keeperCount ?? 0;
  const future = draft.keeperCountFuture ?? 0;
  if (now === 0 && future === 0) return "redraft";
  return "keeper";
}
