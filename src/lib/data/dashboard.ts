/**
 * The single entry point every view goes through to get data.
 *
 * Cache-aside: serve from Postgres when it has this season, otherwise fetch
 * live from Sleeper. That keeps the dashboard usable before Postgres is
 * provisioned and keeps working if a sync has not run yet, without the views
 * knowing which path they got.
 */
import { env, hasDatabase } from "@/lib/env";
import { describeDbError } from "@/lib/db/errors";
import type { DashboardData } from "@/lib/domain/types";
import { loadDashboardLive, type LoadOptions } from "./live";
import { loadDashboardFromCache } from "./repo";

/**
 * Live mode reads Sleeper only. ESPN leagues live in the cache or nowhere, so
 * a configured ESPN account silently losing its leagues would look like a bug
 * rather than a limitation — say so instead.
 */
function liveModeWarnings(): string[] {
  if (env.espnLeagueIds.length === 0) return [];
  return [
    `${env.espnLeagueIds.length} ESPN league(s) are configured but live mode reads Sleeper only — run \`npm run sync\` to see them.`,
  ];
}

export async function loadDashboard(
  options: LoadOptions = {},
): Promise<DashboardData> {
  if (hasDatabase()) {
    try {
      const cached = await loadDashboardFromCache(options);
      if (cached && cached.teams.length > 0) return cached;
    } catch (err) {
      // A cache problem should degrade to live, not take the page down.
      const live = await loadDashboardLive(options);
      return {
        ...live,
        warnings: [
          ...live.warnings,
          `Postgres cache unavailable, served live from Sleeper: ${describeDbError(err)}`,
          ...liveModeWarnings(),
        ],
      };
    }

    const live = await loadDashboardLive(options);
    return {
      ...live,
      warnings: [
        ...live.warnings,
        "Cache is empty — served live from Sleeper. Run `npm run sync` to populate Postgres.",
        ...liveModeWarnings(),
      ],
    };
  }

  const live = await loadDashboardLive(options);
  return {
    ...live,
    warnings: [
      ...live.warnings,
      "No DATABASE_URL configured — running in live mode without the Postgres cache.",
      ...liveModeWarnings(),
    ],
  };
}
