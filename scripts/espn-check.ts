/**
 * ESPN pre-flight — `npm run espn:check`.
 *
 * Answers one question before any integration work depends on it: do the
 * configured cookies actually open the configured leagues? ESPN returns the
 * same 401 for "no cookies", "wrong cookies", "expired cookies" and "you are
 * not in this league", so the useful part is testing each league separately
 * and reporting what came back.
 *
 * Reads only. Writes nothing to the database.
 */
import "dotenv/config";

import { EspnApiError, espn } from "../src/lib/platforms/espn/client";
import { env, espnCredentials } from "../src/lib/env";

interface LeagueProbe {
  id?: number;
  settings?: {
    name?: string;
    size?: number;
    scoringSettings?: { scoringType?: string };
    rosterSettings?: { lineupSlotCounts?: Record<string, number> };
    acquisitionSettings?: { acquisitionBudget?: number; acquisitionType?: string };
  };
  status?: { currentMatchupPeriod?: number; latestScoringPeriod?: number };
  teams?: Array<{
    id: number;
    name?: string;
    abbrev?: string;
    owners?: string[];
    record?: { overall?: { wins?: number; losses?: number; ties?: number } };
    transactionCounter?: { acquisitionBudgetSpent?: number };
  }>;
}

async function main() {
  const season = env.season ?? "2026";
  const credentials = espnCredentials();

  console.log(`ESPN pre-flight — season ${season}\n`);

  if (!credentials) {
    console.log("Cookies:      not configured (ESPN_S2 / ESPN_SWID)");
  } else {
    const tail = credentials.espnS2.slice(-6);
    console.log(`Cookies:      configured (espn_s2 …${tail}, SWID ${credentials.swid})`);
  }

  if (env.espnLeagueIds.length === 0) {
    console.error(
      "\nNo ESPN_LEAGUE_IDS set. Add a comma-separated list to .env, e.g.\n" +
        "  ESPN_LEAGUE_IDS=1597896928,64251973",
    );
    process.exitCode = 1;
    return;
  }

  let failures = 0;

  for (const leagueId of env.espnLeagueIds) {
    console.log(`\n--- league ${leagueId} ---`);
    try {
      const league = await espn.getLeague<LeagueProbe>(
        leagueId,
        season,
        ["mSettings", "mTeam"],
        credentials,
      );

      const s = league.settings;
      const budget = s?.acquisitionSettings?.acquisitionBudget;
      console.log(`  name        ${s?.name ?? "—"}`);
      console.log(`  size        ${s?.size ?? league.teams?.length ?? "—"} teams`);
      console.log(`  scoring     ${s?.scoringSettings?.scoringType ?? "—"}`);
      console.log(
        `  waivers     ${s?.acquisitionSettings?.acquisitionType ?? "—"}` +
          (budget != null ? ` (budget ${budget})` : ""),
      );
      console.log(`  week        ${league.status?.currentMatchupPeriod ?? "—"}`);

      const teams = league.teams ?? [];
      console.log(`  teams       ${teams.length} returned`);
      for (const t of teams.slice(0, 4)) {
        const r = t.record?.overall;
        const spent = t.transactionCounter?.acquisitionBudgetSpent;
        console.log(
          `    ${String(t.id).padStart(3)}  ${(t.name ?? t.abbrev ?? "—").padEnd(28)}` +
            ` ${r ? `${r.wins ?? 0}-${r.losses ?? 0}` : "—"}` +
            (spent != null ? `  FAAB spent ${spent}` : ""),
        );
      }
      if (teams.length > 4) console.log(`    …and ${teams.length - 4} more`);
    } catch (err) {
      failures++;
      if (err instanceof EspnApiError && err.isAuthFailure) {
        console.error(
          "  FAILED — ESPN says not authorized.\n" +
            "  Either the cookies are missing/expired, or this account is not in this league.\n" +
            "  Re-copy espn_s2 and SWID from a logged-in fantasy.espn.com session.",
        );
      } else {
        console.error(`  FAILED — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(
    `\n${env.espnLeagueIds.length - failures}/${env.espnLeagueIds.length} leagues readable.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\nPre-flight failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
