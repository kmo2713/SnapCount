/**
 * Assembles the head-to-head view of a week's matchup.
 *
 * The alignment rule: both teams in a league share the same `roster_positions`,
 * so starter N on one side occupies the same lineup slot as starter N on the
 * other. Aligning on `slotIndex` — not on position — is what makes the two
 * columns line up row for row, including flex slots where the two managers have
 * started different positions.
 */
import type {
  LeagueTeam,
  MatchupDetail,
  MatchupSlotRow,
  MatchupTeamView,
  MyTeam,
  RosterPlayer,
} from "./types";
import { sumProjected } from "./scoring";

/** Starters in lineup order, which is the order the league defines. */
export function orderedStarters(team: { roster: RosterPlayer[] }): RosterPlayer[] {
  return team.roster
    .filter((p) => p.starter)
    .sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
}

/** Null rather than 0 when nobody in the lineup has a projection. */
function projectedTotal(starters: RosterPlayer[]): number | null {
  const values = starters.map((p) => p.projectedPoints);
  return values.some((v) => v != null) ? sumProjected(values) : null;
}

/** Live total, preferring the platform's own figure over summing players. */
function liveTotal(
  reported: number | null,
  starters: RosterPlayer[],
): number | null {
  if (reported != null) return reported;
  const values = starters.map((p) => p.points).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;
}

function toTeamView(
  team: LeagueTeam,
  reportedScore: number | null,
): MatchupTeamView {
  const starters = orderedStarters(team);
  return {
    id: team.id,
    name: team.name,
    ownerName: team.ownerName,
    avatar: team.avatar,
    record: team.record,
    wins: team.wins,
    losses: team.losses,
    ties: team.ties,
    pointsFor: team.pointsFor,
    score: liveTotal(reportedScore, starters),
    projected: projectedTotal(starters),
    starters,
    bench: team.roster.filter((p) => p.kind === "bench"),
  };
}

/**
 * Builds the head-to-head detail for one of your teams' current matchup.
 * Returns null when the team has no matchup this week (a bye, or a league that
 * has not started).
 */
export function buildMatchupDetail(team: MyTeam): MatchupDetail | null {
  if (!team.matchup) return null;

  const myLeagueTeam = team.leagueTeams.find((t) => t.isMine);
  if (!myLeagueTeam) return null;

  const oppLeagueTeam = team.matchup.opponent
    ? team.leagueTeams.find((t) => t.id === team.matchup!.opponent!.teamId)
    : undefined;

  const mine = toTeamView(myLeagueTeam, team.matchup.mine.score);
  const opponent = oppLeagueTeam
    ? toTeamView(oppLeagueTeam, team.matchup.opponent?.score ?? null)
    : null;

  /* -- align the two lineups slot by slot -- */
  const slotCount = Math.max(
    mine.starters.length,
    opponent?.starters.length ?? 0,
    team.startingSlots.length,
  );

  const slots: MatchupSlotRow[] = [];
  for (let i = 0; i < slotCount; i++) {
    const mineAt = mine.starters.find((p) => p.slotIndex === i) ?? null;
    const oppAt = opponent?.starters.find((p) => p.slotIndex === i) ?? null;
    // Prefer the league's declared slot name; fall back to whoever is in it.
    const slot =
      team.startingSlots[i] ??
      mineAt?.slotPosition ??
      oppAt?.slotPosition ??
      "FLEX";
    if (!mineAt && !oppAt && i >= team.startingSlots.length) continue;
    slots.push({ slot, slotIndex: i, mine: mineAt, opponent: oppAt });
  }

  const hasProjections =
    mine.starters.some((p) => p.projectedPoints != null) ||
    (opponent?.starters.some((p) => p.projectedPoints != null) ?? false);

  return {
    teamId: team.id,
    leagueId: team.leagueId,
    leagueName: team.leagueName,
    platform: team.platform,
    leagueFormat: team.leagueFormat,
    week: team.matchup.week,
    season: team.season,
    matchupId: team.matchup.matchupId,
    mine,
    opponent,
    slots,
    hasProjections,
  };
}

/** Every matchup you have this week, one per team. */
export function buildAllMatchups(teams: MyTeam[]): MatchupDetail[] {
  return teams
    .map(buildMatchupDetail)
    .filter((m): m is MatchupDetail => m !== null);
}

/**
 * The projected margin, from your side. Positive means you are favoured.
 * Null when either side has no projection to compare.
 */
export function projectedMargin(detail: MatchupDetail): number | null {
  if (detail.mine.projected == null || detail.opponent?.projected == null) {
    return null;
  }
  return Math.round((detail.mine.projected - detail.opponent.projected) * 100) / 100;
}

/** The live margin, from your side. */
export function liveMargin(detail: MatchupDetail): number | null {
  if (detail.mine.score == null || detail.opponent?.score == null) return null;
  return Math.round((detail.mine.score - detail.opponent.score) * 100) / 100;
}
