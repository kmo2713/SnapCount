/**
 * Wire types for a single ESPN league response.
 *
 * Read off live payloads from the two configured leagues, so fields that only
 * one of them happened to carry are optional. The shapes worth knowing about:
 *
 *  - Rosters do **not** arrive under `teams[].roster` for these leagues, even
 *    when `mRoster` is requested on its own. They come from `mMatchup`, nested
 *    inside `schedule[].home/away.rosterForCurrentScoringPeriod`.
 *  - `lineupSlotId` is a separate enumeration from `defaultPositionId` — see
 *    LINEUP_SLOT and POSITION_BY_ID in ./players.
 *  - A player's `stats` array mixes actual and projected rows, distinguished
 *    by `statSourceId` (0 actual, 1 projected).
 */
import type { EspnPlayer } from "./types";

export interface EspnLeagueResponse {
  id?: number;
  seasonId?: number;
  scoringPeriodId?: number;
  settings?: EspnLeagueSettings;
  status?: EspnLeagueStatus;
  members?: EspnMember[];
  teams?: EspnTeam[];
  schedule?: EspnMatchup[];
  draftDetail?: { drafted?: boolean; inProgress?: boolean };
}

export interface EspnLeagueSettings {
  name?: string;
  size?: number;
  rosterSettings?: {
    /** lineupSlotId -> how many of that slot the league starts. */
    lineupSlotCounts?: Record<string, number>;
  };
  draftSettings?: {
    type?: string;
    /** Keepers held this season, and next. Both zero means redraft. */
    keeperCount?: number;
    keeperCountFuture?: number;
    /** ESPN's nearest thing to a format label; reports NONE more often than not. */
    leagueSubType?: string;
  };
  scoringSettings?: {
    scoringType?: string;
    scoringItems?: unknown;
  };
  acquisitionSettings?: {
    /** WAIVERS_TRADITIONAL is a priority list; FAAB-style types bid. */
    acquisitionType?: string;
    /** Present even in priority leagues, where it means nothing. */
    acquisitionBudget?: number;
  };
  scheduleSettings?: { matchupPeriodCount?: number };
}

export interface EspnLeagueStatus {
  currentMatchupPeriod?: number;
  latestScoringPeriod?: number;
  isActive?: boolean;
  finalScoringPeriod?: number;
}

/** A human in the league. `id` is their SWID, braces included. */
export interface EspnMember {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

export interface EspnTeam {
  id: number;
  name?: string;
  abbrev?: string;
  logo?: string;
  /** SWIDs — matching yours against these is how "my team" is found. */
  owners?: string[];
  playoffSeed?: number;
  points?: number;
  pointsAgainst?: number;
  record?: {
    overall?: {
      wins?: number;
      losses?: number;
      ties?: number;
      pointsFor?: number;
      pointsAgainst?: number;
    };
  };
  transactionCounter?: {
    acquisitionBudgetSpent?: number;
    waiverBudgetSpent?: number;
  };
  /** Usually empty for these leagues; rosters come from the schedule instead. */
  roster?: { entries?: EspnRosterEntry[] };
}

export interface EspnRosterEntry {
  playerId: number;
  lineupSlotId: number;
  injuryStatus?: string | null;
  acquisitionType?: string | null;
  playerPoolEntry?: {
    id?: number;
    appliedStatTotal?: number;
    player?: EspnRosterPlayer;
  };
}

/** The player object inside a roster entry — richer than the universe row. */
export interface EspnRosterPlayer extends EspnPlayer {
  injuryStatus?: string | null;
  injured?: boolean;
  stats?: EspnPlayerStat[];
}

export interface EspnPlayerStat {
  /** 0 = actual, 1 = projected. */
  statSourceId?: number;
  /** 1 = a single week, 0 = season total. */
  statSplitTypeId?: number;
  scoringPeriodId?: number;
  seasonId?: number;
  /** Points with this league's scoring already applied. */
  appliedTotal?: number;
}

export interface EspnMatchupSide {
  teamId: number;
  totalPoints?: number;
  /**
   * Not a reliable "has this been played" signal — it reads 0 even for a
   * finished week that scored 116.62. Use `pointsByScoringPeriod` instead.
   */
  gamesPlayed?: number;
  /** Period -> score, present only for periods that have actually scored. */
  pointsByScoringPeriod?: Record<string, number>;
  /** The full roster, with correct lineup slots. This is the one to use. */
  rosterForCurrentScoringPeriod?: { entries?: EspnRosterEntry[] };
  /**
   * Starters only, and its `lineupSlotId` is unusable — every entry reports
   * slot 0. Its actuals do sum to the team's score, but so do the starters in
   * `rosterForCurrentScoringPeriod`, which also knows which slot each was in.
   */
  rosterForMatchupPeriod?: { entries?: EspnRosterEntry[] };
}

export interface EspnMatchup {
  id?: number;
  matchupPeriodId?: number;
  winner?: string;
  home?: EspnMatchupSide;
  away?: EspnMatchupSide;
}
