/**
 * Wire types for ESPN's fantasy API.
 *
 * ESPN publishes no documentation for any of this — the shapes below were read
 * off live responses, so treat every field as optional unless we have seen it
 * on every row. Anything ESPN adds later is simply ignored rather than
 * breaking a parse.
 */

/** One entry from the player universe (`/players?view=players_wl`). */
export interface EspnPlayer {
  /** ESPN's player id. Team defenses are negative: -16001 is the Falcons. */
  id: number;
  /**
   * Absent on a handful of placeholder rows ESPN carries in the universe
   * (negative ids with no name and position 0), so callers must tolerate it.
   */
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** See POSITION_BY_ID — 1 QB, 2 RB, 3 WR, 4 TE, 5 K, 16 D/ST. */
  defaultPositionId: number;
  /** Lineup slots this player may fill. */
  eligibleSlots?: number[];
  /** Index into the proTeams table; 0 means no NFL team. */
  proTeamId: number;
  ownership?: { percentOwned?: number } | null;
}

/** An NFL team as ESPN numbers them. */
export interface EspnProTeam {
  id: number;
  abbrev: string;
  location?: string;
  name?: string;
  /** ESPN publishes byes right here, unlike Sleeper. */
  byeWeek?: number;
}

/** `/seasons/{season}?view=proTeamSchedules_wl`. */
export interface EspnSeasonResponse {
  settings?: { proTeams?: EspnProTeam[] };
}

/**
 * ESPN's error envelope. `details[].type` is the machine-readable part —
 * AUTH_LEAGUE_NOT_VISIBLE is what expired cookies look like.
 */
export interface EspnErrorResponse {
  messages?: string[];
  details?: Array<{
    message?: string;
    shortMessage?: string;
    type?: string;
  }>;
}
