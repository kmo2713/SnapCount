/**
 * Snap Count database schema.
 *
 * Designed to hold Sleeper, Yahoo and ESPN data side by side even though only
 * Sleeper is wired up today. The rules that make that work:
 *
 *  1. Every row that came from an upstream provider carries `platform` plus the
 *     provider's own id (platformLeagueId, platformTeamId, ...). Snap Count
 *     never reuses a provider id as a primary key, so two platforms can hand us
 *     the same numeric id without colliding.
 *  2. Players are a single canonical dimension. Sleeper's player dump already
 *     carries espn_id and yahoo_id, so Sleeper seeds the table and the other
 *     platforms resolve into it through playerAliases. A Yahoo/ESPN-only player
 *     still gets a canonical row plus an alias, so nothing is dropped.
 *  3. Anything platform-specific we have not normalised yet is kept in a `raw`
 *     jsonb column, so a view can reach for a field without a migration.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const platformEnum = pgEnum("platform", ["sleeper", "yahoo", "espn"]);

/** Where a player sits on a roster right now. */
export const rosterSlotKindEnum = pgEnum("roster_slot_kind", [
  "starter",
  "bench",
  "ir",
  "taxi",
]);

export const credentialKindEnum = pgEnum("credential_kind", [
  "oauth2", // Yahoo
  "cookie", // ESPN (espn_s2 + SWID)
  "none", // Sleeper
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "running",
  "success",
  "error",
]);

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

/* -------------------------------------------------------------------------
   Accounts + credentials
   ------------------------------------------------------------------------- */

/**
 * One linked account per platform. Sleeper needs nothing but a username;
 * Yahoo and ESPN will hang their credentials off this row.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    platform: platformEnum().notNull(),
    /** Provider's own user id (Sleeper user_id, Yahoo guid, ESPN SWID). */
    platformUserId: text().notNull(),
    username: text(),
    displayName: text(),
    avatar: text(),
    isActive: boolean().notNull().default(true),
    lastSyncedAt: timestamp({ withTimezone: true }),
    raw: jsonb(),
    ...timestamps,
  },
  (t) => [uniqueIndex("accounts_platform_user_uq").on(t.platform, t.platformUserId)],
);

/**
 * Encrypted platform credentials. Empty until the Yahoo OAuth and ESPN cookie
 * flows land - Sleeper never writes here. `payload` is ciphertext, never
 * plaintext tokens.
 */
export const credentials = pgTable(
  "credentials",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    kind: credentialKindEnum().notNull(),
    /** AES-GCM ciphertext of the token/cookie bundle. */
    payload: text().notNull(),
    /** Initialisation vector for the ciphertext above. */
    iv: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("credentials_account_kind_uq").on(t.accountId, t.kind)],
);

/* -------------------------------------------------------------------------
   NFL reference data
   ------------------------------------------------------------------------- */

/** Current NFL week/season, mirrored from Sleeper's /state/nfl. */
export const nflState = pgTable("nfl_state", {
  id: text().primaryKey().default("nfl"),
  season: text().notNull(),
  seasonType: text().notNull(),
  week: integer().notNull(),
  displayWeek: integer().notNull(),
  leagueSeason: text(),
  previousSeason: text(),
  seasonStartDate: text(),
  ...timestamps,
});

/**
 * NFL teams and their bye week for a season. Sleeper does not publish byes, so
 * these are derived from ESPN's public scoreboard feed (week.teamsOnBye).
 */
export const nflTeams = pgTable(
  "nfl_teams",
  {
    id: uuid().primaryKey().defaultRandom(),
    season: text().notNull(),
    abbr: text().notNull(),
    name: text(),
    byeWeek: integer(),
    ...timestamps,
  },
  (t) => [uniqueIndex("nfl_teams_season_abbr_uq").on(t.season, t.abbr)],
);

/* -------------------------------------------------------------------------
   Players
   ------------------------------------------------------------------------- */

/**
 * Canonical player dimension, seeded from Sleeper's /players/nfl dump (~12k
 * rows, ~15MB - refresh at most daily). espnId/yahooId come straight from
 * Sleeper and let the other two platforms resolve onto the same row.
 */
export const players = pgTable(
  "players",
  {
    /** Canonical id. Sleeper's player_id when known ("4034", "BAL"). */
    id: text().primaryKey(),
    sleeperId: text(),
    espnId: text(),
    yahooId: text(),
    gsisId: text(),
    sportradarId: text(),

    fullName: text().notNull(),
    firstName: text(),
    lastName: text(),
    searchName: text(),

    position: text(),
    fantasyPositions: text().array(),
    nflTeam: text(),
    number: integer(),
    age: integer(),
    yearsExp: integer(),
    college: text(),
    height: text(),
    weight: text(),

    status: text(),
    injuryStatus: text(),
    injuryBodyPart: text(),
    injuryNotes: text(),
    practiceParticipation: text(),

    depthChartPosition: text(),
    depthChartOrder: integer(),
    searchRank: integer(),
    active: boolean().default(true),
    newsUpdated: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("players_search_name_idx").on(t.searchName),
    index("players_position_idx").on(t.position),
    index("players_nfl_team_idx").on(t.nflTeam),
    index("players_espn_id_idx").on(t.espnId),
    index("players_yahoo_id_idx").on(t.yahooId),
  ],
);

/**
 * Maps a platform's player id onto a canonical player. Sleeper ids map 1:1;
 * Yahoo/ESPN rows get written when those integrations land.
 */
export const playerAliases = pgTable(
  "player_aliases",
  {
    platform: platformEnum().notNull(),
    platformPlayerId: text().notNull(),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.platformPlayerId] }),
    index("player_aliases_player_idx").on(t.playerId),
  ],
);

/**
 * Weekly per-player statistical projections.
 *
 * Sleeper serves these from an undocumented endpoint (api.sleeper.com/
 * projections/...) sourced from Rotowire. `stats` holds the full projected stat
 * line — pass_yd, rec, rush_td and so on — which is what actually matters:
 * every league scores those raw stats differently, so Snap Count multiplies
 * them through each league's own scoring_settings rather than trusting the
 * generic pts_ppr figure. The three pts_* columns are kept as a fallback for
 * leagues whose scoring we cannot fully resolve.
 */
export const playerProjections = pgTable(
  "player_projections",
  {
    season: text().notNull(),
    week: integer().notNull(),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    /** Projection provider, e.g. "rotowire". */
    company: text(),
    /** Full projected stat line, keyed the same way scoring_settings is. */
    stats: jsonb().notNull(),
    ptsPpr: real(),
    ptsHalfPpr: real(),
    ptsStd: real(),
    opponent: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.season, t.week, t.playerId] }),
    index("player_projections_week_idx").on(t.season, t.week),
  ],
);

/** Trending add/drop counts. Sleeper publishes these; other platforms may not. */
export const trendingPlayers = pgTable(
  "trending_players",
  {
    platform: platformEnum().notNull(),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    kind: text().notNull(), // "add" | "drop"
    count: integer().notNull(),
    lookbackHours: integer().notNull().default(24),
    capturedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.platform, t.playerId, t.kind] })],
);

/* -------------------------------------------------------------------------
   Leagues, members, teams
   ------------------------------------------------------------------------- */

export const leagues = pgTable(
  "leagues",
  {
    id: uuid().primaryKey().defaultRandom(),
    platform: platformEnum().notNull(),
    platformLeagueId: text().notNull(),
    accountId: uuid().references(() => accounts.id, { onDelete: "set null" }),

    season: text().notNull(),
    name: text().notNull(),
    avatar: text(),
    /** pre_draft | drafting | in_season | complete */
    status: text(),
    totalRosters: integer(),
    /** Ordered lineup slots, e.g. ["QB","RB","RB","WR","FLEX","BN",...]. */
    rosterPositions: text().array(),
    scoringSettings: jsonb(),
    settings: jsonb(),
    /** Same league, prior season - lets us show last year's finish. */
    previousPlatformLeagueId: text(),
    platformDraftId: text(),

    raw: jsonb(),
    lastSyncedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("leagues_platform_league_season_uq").on(
      t.platform,
      t.platformLeagueId,
      t.season,
    ),
    index("leagues_season_idx").on(t.season),
  ],
);

/** A human manager in a league (Sleeper "user", Yahoo/ESPN "manager"). */
export const leagueMembers = pgTable(
  "league_members",
  {
    id: uuid().primaryKey().defaultRandom(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    platformUserId: text().notNull(),
    displayName: text(),
    teamName: text(),
    avatar: text(),
    /** True when this manager is the Snap Count owner. */
    isMe: boolean().notNull().default(false),
    raw: jsonb(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("league_members_league_user_uq").on(t.leagueId, t.platformUserId),
  ],
);

/** A roster/franchise inside a league - one row per team, not just yours. */
export const teams = pgTable(
  "teams",
  {
    id: uuid().primaryKey().defaultRandom(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    /** Sleeper roster_id, Yahoo team_key, ESPN teamId - always stored as text. */
    platformTeamId: text().notNull(),
    memberId: uuid().references(() => leagueMembers.id, { onDelete: "set null" }),

    name: text(),
    avatar: text(),
    isMine: boolean().notNull().default(false),

    wins: integer().notNull().default(0),
    losses: integer().notNull().default(0),
    ties: integer().notNull().default(0),
    pointsFor: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    pointsAgainst: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    /** Max points the roster could have scored with a perfect lineup. */
    potentialPoints: numeric({ precision: 10, scale: 2 }),
    waiverPosition: integer(),
    waiverBudgetUsed: integer(),
    division: integer(),
    streak: text(),

    raw: jsonb(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("teams_league_platform_team_uq").on(t.leagueId, t.platformTeamId),
    index("teams_is_mine_idx").on(t.isMine),
  ],
);

/**
 * Current roster composition. `slotPosition` is the lineup slot the player
 * occupies ("QB", "FLEX", "SUPER_FLEX", "BN"); `slotIndex` preserves the
 * platform's own ordering so starters render in league order.
 */
export const rosterSlots = pgTable(
  "roster_slots",
  {
    id: uuid().primaryKey().defaultRandom(),
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    kind: rosterSlotKindEnum().notNull(),
    slotPosition: text(),
    slotIndex: integer(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("roster_slots_team_player_uq").on(t.teamId, t.playerId),
    index("roster_slots_player_idx").on(t.playerId),
  ],
);

/* -------------------------------------------------------------------------
   Matchups
   ------------------------------------------------------------------------- */

export const matchups = pgTable(
  "matchups",
  {
    id: uuid().primaryKey().defaultRandom(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    season: text().notNull(),
    week: integer().notNull(),
    /** Groups the two sides of a head-to-head. Null for bye/orphan weeks. */
    platformMatchupId: text(),
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    opponentTeamId: uuid().references(() => teams.id, { onDelete: "set null" }),
    points: numeric({ precision: 10, scale: 2 }),
    projectedPoints: numeric({ precision: 10, scale: 2 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("matchups_league_week_team_uq").on(t.leagueId, t.week, t.teamId),
    index("matchups_week_idx").on(t.season, t.week),
  ],
);

/** Per-player scoring inside a matchup, from Sleeper's players_points. */
export const matchupPlayers = pgTable(
  "matchup_players",
  {
    id: uuid().primaryKey().defaultRandom(),
    matchupId: uuid()
      .notNull()
      .references(() => matchups.id, { onDelete: "cascade" }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    points: real(),
    /**
     * Projected points, already scored by this league's own settings.
     *
     * Only ESPN populates this: it publishes a per-player projection that has
     * the league's scoring applied, so there is nothing left to compute. The
     * Sleeper path instead stores a raw stat line in `player_projections` and
     * multiplies it through each league's `scoring_settings` at read time,
     * because Sleeper's projection is generic across leagues. Both roads end
     * at the same domain field.
     */
    projectedPoints: real(),
    isStarter: boolean().notNull().default(false),
    slotIndex: integer(),
    /** Lineup slot label for platforms that report it per player, e.g. "FLEX". */
    slotPosition: text(),
  },
  (t) => [
    uniqueIndex("matchup_players_matchup_player_uq").on(t.matchupId, t.playerId),
  ],
);

/* -------------------------------------------------------------------------
   Drafts
   ------------------------------------------------------------------------- */

export const drafts = pgTable(
  "drafts",
  {
    id: uuid().primaryKey().defaultRandom(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    platformDraftId: text().notNull(),
    season: text().notNull(),
    type: text(),
    status: text(),
    rounds: integer(),
    startTime: timestamp({ withTimezone: true }),
    settings: jsonb(),
    ...timestamps,
  },
  (t) => [uniqueIndex("drafts_platform_draft_uq").on(t.platformDraftId)],
);

export const draftPicks = pgTable(
  "draft_picks",
  {
    id: uuid().primaryKey().defaultRandom(),
    draftId: uuid()
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    pickNo: integer().notNull(),
    round: integer().notNull(),
    draftSlot: integer(),
    /** May be null if the drafting roster no longer exists. */
    teamId: uuid().references(() => teams.id, { onDelete: "set null" }),
    playerId: text().references(() => players.id, { onDelete: "set null" }),
    pickedByPlatformUserId: text(),
    isKeeper: boolean().default(false),
    metadata: jsonb(),
    ...timestamps,
  },
  (t) => [uniqueIndex("draft_picks_draft_pick_uq").on(t.draftId, t.pickNo)],
);

/* -------------------------------------------------------------------------
   AI analysis
   ------------------------------------------------------------------------- */

/**
 * Cached Claude analyses, keyed by a hash of the exact inputs.
 *
 * Without this, opening the Lineups view twice would bill twice for an
 * identical answer. The key covers everything that could change the verdict —
 * who is starting, their status, their projection — so a real roster change
 * invalidates it and nothing else does.
 */
export const aiAnalyses = pgTable(
  "ai_analyses",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** "lineup" | "trade" */
    kind: text().notNull(),
    /** Hash of the inputs; see lineupCacheKey / tradeCacheKey. */
    cacheKey: text().notNull(),
    season: text(),
    week: integer(),
    leagueId: uuid().references(() => leagues.id, { onDelete: "cascade" }),
    teamId: uuid().references(() => teams.id, { onDelete: "cascade" }),
    /** The structured analysis, shaped by the matching Zod schema. */
    payload: jsonb().notNull(),
    model: text(),
    inputTokens: integer(),
    outputTokens: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_analyses_cache_key_uq").on(t.cacheKey),
    index("ai_analyses_kind_idx").on(t.kind, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------
   Sync bookkeeping
   ------------------------------------------------------------------------- */

/** One row per sync attempt, so the UI can show freshness and failures. */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    platform: platformEnum(),
    /** "leagues" | "players" | "schedule" | "trending" | "all" */
    scope: text().notNull(),
    status: syncStatusEnum().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    durationMs: integer(),
    error: text(),
    stats: jsonb(),
  },
  (t) => [index("sync_runs_started_idx").on(t.startedAt)],
);

/* -------------------------------------------------------------------------
   Game day
   ------------------------------------------------------------------------- */

/**
 * One sample of a Sunday, for the day timeline and the post-game recap.
 *
 * Append-only, so it follows the `syncRuns` shape rather than the shared
 * `timestamps` spread: nothing here is ever updated in place.
 *
 * The whole day lands in one jsonb column per sample rather than a row per
 * team. That is a deliberate trade: 104 teams sampled every thirty seconds
 * across a six-hour Sunday is roughly 75,000 rows, against about 720 this way,
 * for a chart that reads the whole sample at once anyway. It also keeps NFL
 * game state alongside the fantasy scores, which is what lets the timeline
 * explain its own spikes rather than just showing them.
 *
 * `bucket` is the sample time quantised to the writer's cadence, and it exists
 * only to be the dedupe key: the writer is a cron that can fire twice or be
 * retried, and a timeline with duplicate samples draws a lie. Writes are
 * `onConflictDoNothing` against it.
 */
export const gamedaySnapshots = pgTable(
  "gameday_snapshots",
  {
    id: uuid().primaryKey().defaultRandom(),
    season: text().notNull(),
    week: integer().notNull(),
    /** Quantised sample time. The natural key, with season and week. */
    bucket: timestamp({ withTimezone: true }).notNull(),
    capturedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Every league's scores plus NFL game state, as one compact object. */
    payload: jsonb().notNull(),
  },
  (t) => [
    uniqueIndex("gameday_snapshots_bucket_uq").on(t.season, t.week, t.bucket),
    index("gameday_snapshots_captured_idx").on(t.capturedAt),
  ],
);
