/**
 * Raw Sleeper API response shapes, as observed against the live API.
 * These mirror the wire format exactly — normalisation happens in normalize.ts.
 */

export interface SleeperUser {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  metadata: Record<string, string> | null;
}

export interface SleeperState {
  season: string;
  season_type: string; // "pre" | "regular" | "post" | "off"
  week: number;
  display_week: number;
  league_season: string;
  previous_season: string;
  season_start_date: string;
  leg: number;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  season_type: string;
  sport: string;
  status: string; // pre_draft | drafting | in_season | complete
  avatar: string | null;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number> | null;
  settings: Record<string, number> | null;
  previous_league_id: string | null;
  draft_id: string | null;
}

/** A manager in a league. `metadata.team_name` is the custom team name. */
export interface SleeperLeagueUser {
  user_id: string;
  display_name: string | null;
  avatar: string | null;
  is_owner: boolean | null;
  is_bot: boolean | null;
  metadata: Record<string, string> | null;
}

export interface SleeperRosterSettings {
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fpts_decimal?: number;
  fpts_against?: number;
  fpts_against_decimal?: number;
  ppts?: number;
  ppts_decimal?: number;
  waiver_position?: number;
  waiver_budget_used?: number;
  total_moves?: number;
  division?: number;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  co_owners: string[] | null;
  league_id: string;
  /** All rostered player ids, including bench/IR/taxi. */
  players: string[] | null;
  /** Positional — index N corresponds to the Nth non-bench roster slot. */
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: SleeperRosterSettings;
  /** Holds per-player nicknames as `p_nick_<player_id>` keys. */
  metadata: Record<string, string> | null;
}

export interface SleeperMatchup {
  roster_id: number;
  /** Groups the two sides of a head-to-head. Null when a roster has a bye. */
  matchup_id: number | null;
  points: number | null;
  custom_points: number | null;
  players: string[] | null;
  starters: string[] | null;
  starters_points: number[] | null;
  players_points: Record<string, number> | null;
}

export interface SleeperPlayer {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  search_full_name?: string;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  number?: number | null;
  age?: number | null;
  years_exp?: number | null;
  college?: string | null;
  height?: string | null;
  weight?: string | null;
  status?: string | null;
  injury_status?: string | null;
  injury_body_part?: string | null;
  injury_notes?: string | null;
  practice_participation?: string | null;
  depth_chart_position?: string | null;
  depth_chart_order?: number | null;
  search_rank?: number | null;
  active?: boolean | null;
  news_updated?: number | null;
  espn_id?: number | string | null;
  yahoo_id?: number | string | null;
  gsis_id?: string | null;
  sportradar_id?: string | null;
}

export type SleeperPlayerMap = Record<string, SleeperPlayer>;

export interface SleeperTrendingPlayer {
  player_id: string;
  count: number;
}

/**
 * A weekly projection record from Sleeper's undocumented projections endpoint.
 * `stats` is the projected stat line, keyed identically to a league's
 * scoring_settings — that shared vocabulary is what lets us score a projection
 * against each league's own rules.
 */
export interface SleeperProjection {
  player_id: string;
  week: number;
  season: string;
  season_type: string;
  category: string;
  company: string | null;
  opponent: string | null;
  stats: Record<string, number> | null;
  player: {
    first_name?: string;
    last_name?: string;
    position?: string | null;
    team?: string | null;
  } | null;
}

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  season: string;
  status: string;
  type: string;
  start_time: number | null;
  settings: Record<string, number> | null;
  draft_order: Record<string, number> | null;
}

export interface SleeperDraftPick {
  pick_no: number;
  round: number;
  draft_slot: number | null;
  roster_id: number | null;
  player_id: string | null;
  picked_by: string | null;
  is_keeper: boolean | null;
  metadata: Record<string, string> | null;
}
