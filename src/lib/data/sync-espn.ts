/**
 * ESPN league sync.
 *
 * Writes the same tables `syncSleeperLeagues` does, with `platform: "espn"`,
 * so `repo.ts` reads both platforms through one query path and no view knows
 * the difference.
 *
 * Two things differ from the Sleeper job, both forced by ESPN rather than
 * chosen:
 *
 *  - There is no "list my leagues" endpoint on the fantasy API, so league
 *    ids come from the separate fan API, merged with anything pinned in
 *    ESPN_LEAGUE_IDS. That lists practice drafts alongside real leagues, so
 *    the mocks are filtered out here rather than at discovery.
 *  - Rosters and per-player scoring come from the schedule (`mMatchup`), since
 *    `mRoster` returns nothing for these leagues.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { requireDb, schema } from "@/lib/db/client";
import { env, espnCredentials } from "@/lib/env";
import { EspnApiError, espn } from "@/lib/platforms/espn/client";
import type { EspnLeagueResponse } from "@/lib/platforms/espn/league-types";
import {
  actualPoints,
  isMockLeague,
  isMyTeam,
  leagueStatus,
  pairingsFor,
  projectedPoints,
  rosterFor,
  rosterPositions,
  teamName,
} from "@/lib/platforms/espn/normalize";

const {
  accounts,
  leagueMembers,
  leagues,
  matchupPlayers,
  matchups,
  playerAliases,
  rosterSlots,
  teams,
} = schema;

/** League-level facts: settings, teams, standings, members. */
const BASE_VIEWS = ["mSettings", "mTeam"];

/**
 * Rosters and per-player scoring, for one week at a time.
 *
 * `scoringPeriodId` is not optional in practice. Omitting it returns the
 * season's final period and *no* roster data at all, and each request carries
 * rosters for exactly the period asked for — so a season is assembled one week
 * per request, the same shape the Sleeper job uses.
 */
const WEEK_VIEWS = ["mMatchup", "mBoxscore"];

const CHUNK_SIZE = 1000;

function chunk<T>(rows: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Postgres numerics arrive as strings; keep the same helper shape as sync.ts. */
function num(value: number | null | undefined): string | null {
  return value == null || !Number.isFinite(value) ? null : String(value);
}

export interface SyncEspnOptions {
  season?: string;
  /** Matchup periods to pull. Defaults to 1..current. */
  weeks?: number[];
}

export interface EspnSyncOutcome {
  stats: Record<string, number>;
  warnings: string[];
}

/**
 * Pulls every configured ESPN league into the cache.
 *
 * Returns rather than throws on a per-league failure: one league with revoked
 * access must not cost you the other, nor the Sleeper half of the sync.
 */
export async function syncEspnLeaguesInner(
  options: SyncEspnOptions = {},
): Promise<EspnSyncOutcome> {
  const db = requireDb();
  const warnings: string[] = [];
  const stats = {
    leagues: 0,
    discovered: 0,
    mocksSkipped: 0,
    teams: 0,
    rosterSlots: 0,
    matchups: 0,
    matchupPlayers: 0,
    skippedPlayers: 0,
  };

  const credentials = espnCredentials();
  const season = options.season ?? env.season ?? String(new Date().getFullYear());

  /*
   * Leagues are discovered from the account rather than read off a hand-kept
   * list, so a league joined mid-season shows up on the next sync instead of
   * staying invisible until someone edits an env var. ESPN_LEAGUE_IDS still
   * works and is merged in — useful for a league the fan API does not return,
   * and as a fallback if discovery fails.
   */
  const configured = env.espnLeagueIds;
  let discovered: string[] = [];
  try {
    discovered = await espn.getMyLeagueIds(season, credentials);
  } catch (err) {
    warnings.push(
      `Could not list ESPN leagues for this account (${err instanceof Error ? err.message : String(err)}); using ESPN_LEAGUE_IDS only.`,
    );
  }

  const leagueIds = [...new Set([...discovered, ...configured])];

  const undiscovered = configured.filter((id) => !discovered.includes(id));
  if (discovered.length > 0 && undiscovered.length > 0) {
    warnings.push(
      `ESPN_LEAGUE_IDS lists ${undiscovered.join(", ")}, which this account does not appear to be in for ${season}.`,
    );
  }

  if (leagueIds.length === 0) {
    return {
      stats,
      warnings: [
        credentials
          ? `No ESPN leagues found for this account in ${season}.`
          : "No ESPN cookies configured; nothing to sync.",
      ],
    };
  }

  /* -- the ESPN -> canonical player map, built by syncEspnAliases -- */
  const aliasRows = await db
    .select({
      platformPlayerId: playerAliases.platformPlayerId,
      playerId: playerAliases.playerId,
    })
    .from(playerAliases)
    .where(eq(playerAliases.platform, "espn"));

  const canonicalId = new Map(
    aliasRows.map((r) => [r.platformPlayerId, r.playerId]),
  );

  if (canonicalId.size === 0) {
    return {
      stats,
      warnings: [
        "No ESPN player crosswalk yet — run `npm run sync -- --espn-ids` first.",
      ],
    };
  }

  /* -- account row, keyed on the SWID -- */
  let accountId: string | null = null;
  if (credentials) {
    const [account] = await db
      .insert(accounts)
      .values({
        platform: "espn",
        platformUserId: credentials.swid,
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [accounts.platform, accounts.platformUserId],
        set: { lastSyncedAt: sql`now()`, updatedAt: sql`now()` },
      })
      .returning({ id: accounts.id });
    accountId = account.id;
  }

  stats.discovered = discovered.length;

  for (const leagueId of leagueIds) {
    let payload: EspnLeagueResponse;
    try {
      payload = await espn.getLeague<EspnLeagueResponse>(
        leagueId,
        season,
        BASE_VIEWS,
        credentials,
      );
    } catch (err) {
      warnings.push(describeLeagueFailure(leagueId, err));
      continue;
    }

    const name = payload.settings?.name?.trim() || `ESPN league ${leagueId}`;

    /*
     * Practice drafts are dropped before anything is written. Discovery
     * cannot avoid finding them — the fan API lists a mock exactly the way it
     * lists a real league — so the filter belongs here, where the settings
     * that give it away have already been fetched. Pinning one in
     * ESPN_LEAGUE_IDS does not override this; it says so instead of quietly
     * ignoring the request.
     */
    if (isMockLeague(payload.settings)) {
      stats.mocksSkipped++;
      if (configured.includes(leagueId)) {
        warnings.push(
          `ESPN_LEAGUE_IDS pins ${leagueId}, but ESPN reports it as a practice draft ` +
            `("${name}") rather than a league being played; skipped.`,
        );
      }
      continue;
    }

    const slots = rosterPositions(payload);
    const currentPeriod = payload.status?.currentMatchupPeriod ?? 1;
    const weeks =
      options.weeks ?? Array.from({ length: currentPeriod }, (_, i) => i + 1);

    /*
     * An undrafted ESPN league still serves a full set of rosters — last
     * season's, carried forward until the draft clears them. Verified rather
     * than assumed: every one of the 382 roster entries these two leagues
     * returned for 2026 was identical to that same team's final 2025 roster.
     *
     * Storing those would present last year's team as this year's, which is
     * exactly the sort of confident wrongness this app is supposed to avoid.
     * A pre-draft league therefore keeps its teams and standings and stores no
     * roster at all — the same thing the Sleeper path does for the two leagues
     * of yours that have not drafted either.
     */
    const status = leagueStatus(payload);
    const undrafted = status === "pre_draft" || status === "drafting";

    /* -- league -- */
    const [leagueRow] = await db
      .insert(leagues)
      .values({
        platform: "espn",
        platformLeagueId: leagueId,
        accountId,
        season,
        name,
        status,
        totalRosters: payload.settings?.size ?? payload.teams?.length ?? null,
        rosterPositions: slots,
        // ESPN's scoring is a different shape from Sleeper's and is never used
        // to score anything — its projections arrive pre-scored. Kept for
        // reference only.
        scoringSettings: payload.settings?.scoringSettings ?? null,
        settings: payload.settings ?? null,
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [leagues.platform, leagues.platformLeagueId, leagues.season],
        set: {
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          totalRosters: sql`excluded.total_rosters`,
          rosterPositions: sql`excluded.roster_positions`,
          scoringSettings: sql`excluded.scoring_settings`,
          settings: sql`excluded.settings`,
          accountId: sql`excluded.account_id`,
          lastSyncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: leagues.id });

    stats.leagues++;

    /* -- members -- */
    const memberIdBySwid = new Map<string, string>();
    const members = payload.members ?? [];
    if (members.length > 0) {
      const inserted = await db
        .insert(leagueMembers)
        .values(
          members.map((m) => ({
            leagueId: leagueRow.id,
            platformUserId: m.id,
            displayName:
              m.displayName?.trim() ||
              [m.firstName, m.lastName].filter(Boolean).join(" ").trim() ||
              null,
            isMe:
              credentials != null &&
              m.id.toUpperCase() === credentials.swid.toUpperCase(),
            raw: m,
          })),
        )
        .onConflictDoUpdate({
          target: [leagueMembers.leagueId, leagueMembers.platformUserId],
          set: {
            displayName: sql`excluded.display_name`,
            isMe: sql`excluded.is_me`,
            raw: sql`excluded.raw`,
            updatedAt: sql`now()`,
          },
        })
        .returning({
          id: leagueMembers.id,
          platformUserId: leagueMembers.platformUserId,
        });
      for (const m of inserted) memberIdBySwid.set(m.platformUserId, m.id);
    }

    /* -- teams -- */
    const espnTeams = payload.teams ?? [];
    const teamIdByEspnId = new Map<number, string>();

    if (espnTeams.length > 0) {
      const inserted = await db
        .insert(teams)
        .values(
          espnTeams.map((t) => {
            const overall = t.record?.overall;
            const owner = (t.owners ?? [])[0];
            return {
              leagueId: leagueRow.id,
              platformTeamId: String(t.id),
              memberId: owner ? (memberIdBySwid.get(owner) ?? null) : null,
              name: teamName(t),
              avatar: t.logo ?? null,
              isMine: isMyTeam(t, credentials?.swid ?? null),
              wins: overall?.wins ?? 0,
              losses: overall?.losses ?? 0,
              ties: overall?.ties ?? 0,
              pointsFor: num(overall?.pointsFor ?? t.points) ?? "0",
              pointsAgainst: num(overall?.pointsAgainst ?? t.pointsAgainst) ?? "0",
              // ESPN reports one spend counter whether or not the league bids.
              waiverBudgetUsed:
                t.transactionCounter?.acquisitionBudgetSpent ??
                t.transactionCounter?.waiverBudgetSpent ??
                null,
              raw: t,
            };
          }),
        )
        .onConflictDoUpdate({
          target: [teams.leagueId, teams.platformTeamId],
          set: {
            memberId: sql`excluded.member_id`,
            name: sql`excluded.name`,
            avatar: sql`excluded.avatar`,
            isMine: sql`excluded.is_mine`,
            wins: sql`excluded.wins`,
            losses: sql`excluded.losses`,
            ties: sql`excluded.ties`,
            pointsFor: sql`excluded.points_for`,
            pointsAgainst: sql`excluded.points_against`,
            waiverBudgetUsed: sql`excluded.waiver_budget_used`,
            raw: sql`excluded.raw`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: teams.id, platformTeamId: teams.platformTeamId });

      for (const t of inserted) teamIdByEspnId.set(Number(t.platformTeamId), t.id);
      stats.teams += inserted.length;
    }

    if (!espnTeams.some((t) => isMyTeam(t, credentials?.swid ?? null))) {
      warnings.push(
        `No team in "${name}" is owned by the configured SWID — the dashboard shows only leagues you play in.`,
      );
    }

    if (undrafted) {
      /*
       * Clear anything an earlier run stored for this league, so correcting
       * the bug also removes the stale rosters it already wrote. Deleting the
       * matchups cascades to their per-player rows.
       */
      const teamIds = [...teamIdByEspnId.values()];
      if (teamIds.length > 0) {
        await db.delete(rosterSlots).where(inArray(rosterSlots.teamId, teamIds));
      }
      await db
        .delete(matchups)
        .where(and(eq(matchups.leagueId, leagueRow.id), eq(matchups.season, season)));

      warnings.push(
        `"${name}" has not drafted yet. ESPN keeps serving last season's rosters until a league drafts, ` +
          `so none are stored — the league appears with its teams and fills in after the draft.`,
      );
      continue;
    }

    /*
     * One request per week. Sequential rather than fanned out: this is an
     * undocumented endpoint being read with borrowed cookies, and a sync job
     * has no deadline worth risking a rate limit for.
     */
    const weekPayloads = new Map<number, EspnLeagueResponse>();
    for (const week of weeks) {
      try {
        weekPayloads.set(
          week,
          await espn.getLeague<EspnLeagueResponse>(
            leagueId,
            season,
            WEEK_VIEWS,
            credentials,
            week,
          ),
        );
      } catch (err) {
        warnings.push(
          `"${name}" week ${week} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (weekPayloads.size === 0) {
      warnings.push(`"${name}" returned no weekly data; rosters left unchanged.`);
      continue;
    }

    /*
     * Rosters reflect the most recent week we successfully read, which is the
     * closest thing ESPN offers to "the roster right now".
     */
    const rosterWeek = Math.max(...weekPayloads.keys());
    const currentRosters = pairingsFor(weekPayloads.get(rosterWeek)!, rosterWeek);
    for (const pairing of currentRosters) {
      const teamId = teamIdByEspnId.get(pairing.teamId);
      if (!teamId || pairing.entries.length === 0) continue;

      const slotRows = [];
      for (const row of rosterFor(pairing.entries, slots)) {
        const playerId = canonicalId.get(row.espnPlayerId);
        if (!playerId) {
          stats.skippedPlayers++;
          continue;
        }
        slotRows.push({
          teamId,
          playerId,
          kind: row.kind,
          slotPosition: row.slotPosition,
          slotIndex: row.slotIndex,
          updatedAt: new Date(),
        });
      }

      if (slotRows.length === 0) {
        await db.delete(rosterSlots).where(eq(rosterSlots.teamId, teamId));
        continue;
      }

      for (const batch of chunk(slotRows)) {
        await db
          .insert(rosterSlots)
          .values(batch)
          .onConflictDoUpdate({
            target: [rosterSlots.teamId, rosterSlots.playerId],
            set: {
              kind: sql`excluded.kind`,
              slotPosition: sql`excluded.slot_position`,
              slotIndex: sql`excluded.slot_index`,
              updatedAt: sql`now()`,
            },
          });
      }
      // Wholesale rewrite, so a dropped player disappears rather than lingering.
      await db.delete(rosterSlots).where(
        and(
          eq(rosterSlots.teamId, teamId),
          notInArray(rosterSlots.playerId, slotRows.map((r) => r.playerId)),
        ),
      );
      stats.rosterSlots += slotRows.length;
    }

    /* -- matchups, week by week -- */
    for (const week of weeks) {
      const weekPayload = weekPayloads.get(week);
      if (!weekPayload) continue;
      const pairings = pairingsFor(weekPayload, week);
      if (pairings.length === 0) continue;

      const rows = pairings
        .map((p) => {
          const teamId = teamIdByEspnId.get(p.teamId);
          if (!teamId) return null;
          return {
            leagueId: leagueRow.id,
            season,
            week,
            platformMatchupId: p.matchupId,
            teamId,
            opponentTeamId:
              p.opponentTeamId != null
                ? (teamIdByEspnId.get(p.opponentTeamId) ?? null)
                : null,
            points: num(p.points),
            updatedAt: new Date(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length === 0) continue;

      const inserted = await db
        .insert(matchups)
        .values(rows)
        .onConflictDoUpdate({
          target: [matchups.leagueId, matchups.week, matchups.teamId],
          set: {
            platformMatchupId: sql`excluded.platform_matchup_id`,
            opponentTeamId: sql`excluded.opponent_team_id`,
            points: sql`excluded.points`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: matchups.id, teamId: matchups.teamId });

      stats.matchups += inserted.length;
      const matchupIdByTeam = new Map(inserted.map((m) => [m.teamId, m.id]));

      /* -- per-player points and projections -- */
      const playerRows = [];
      for (const p of pairings) {
        const teamId = teamIdByEspnId.get(p.teamId);
        if (!teamId) continue;
        const matchupId = matchupIdByTeam.get(teamId);
        if (!matchupId) continue;

        const slotByEspnId = new Map(
          rosterFor(p.entries, slots).map((r) => [r.espnPlayerId, r]),
        );

        for (const entry of p.entries) {
          const espnPlayerId = String(entry.playerId);
          const playerId = canonicalId.get(espnPlayerId);
          if (!playerId) continue;
          const slot = slotByEspnId.get(espnPlayerId);
          playerRows.push({
            matchupId,
            playerId,
            points: actualPoints(entry, week),
            projectedPoints: projectedPoints(entry, week),
            isStarter: slot?.kind === "starter",
            slotIndex: slot?.slotIndex ?? null,
            slotPosition: slot?.slotPosition ?? null,
          });
        }
      }

      for (const batch of chunk(playerRows)) {
        await db
          .insert(matchupPlayers)
          .values(batch)
          .onConflictDoUpdate({
            target: [matchupPlayers.matchupId, matchupPlayers.playerId],
            set: {
              points: sql`excluded.points`,
              projectedPoints: sql`excluded.projected_points`,
              isStarter: sql`excluded.is_starter`,
              slotIndex: sql`excluded.slot_index`,
              slotPosition: sql`excluded.slot_position`,
            },
          });
      }
      stats.matchupPlayers += playerRows.length;
    }
  }

  if (stats.skippedPlayers > 0) {
    warnings.push(
      `${stats.skippedPlayers} ESPN roster entries had no canonical player; re-run \`npm run sync -- --espn-ids\`.`,
    );
  }

  return { stats, warnings };
}

function describeLeagueFailure(leagueId: string, err: unknown): string {
  // Discovery lists practice drafts, and ESPN deletes them shortly after they
  // finish — so an id that resolved on one sync can be gone by the next. Say
  // which of the two this is rather than reporting it as a plain failure.
  if (err instanceof EspnApiError && err.status === 404) {
    return `ESPN league ${leagueId} no longer exists — ${err.message} (practice drafts are deleted soon after they end).`;
  }
  if (err instanceof EspnApiError && err.isAuthFailure) {
    return (
      `ESPN league ${leagueId} refused the request — cookies are missing, expired, ` +
      `or this account is not in that league. Re-copy ESPN_S2 and ESPN_SWID, then run \`npm run espn:check\`.`
    );
  }
  return `ESPN league ${leagueId} failed: ${err instanceof Error ? err.message : String(err)}`;
}
