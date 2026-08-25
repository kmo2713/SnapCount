/**
 * Environment access. Nothing here throws at import time — a missing
 * DATABASE_URL degrades Snap Count to live-fetch mode rather than crashing the
 * whole app, so the Sleeper slice is usable before Postgres is provisioned.
 */

export const env = {
  databaseUrl: process.env.DATABASE_URL?.trim() || null,
  sleeperUsername: process.env.SLEEPER_USERNAME?.trim() || "kmo2713",
  /** Pin a season, or leave unset to follow Sleeper's /state/nfl. */
  season: process.env.SNAP_COUNT_SEASON?.trim() || null,
  syncSecret: process.env.SYNC_SECRET?.trim() || null,
  isProduction: process.env.NODE_ENV === "production",

  /* -- ESPN -- */
  espnS2: process.env.ESPN_S2?.trim() || null,
  espnSwid: process.env.ESPN_SWID?.trim() || null,
  /** Comma-separated ESPN league ids; ESPN has no "list my leagues" endpoint. */
  espnLeagueIds: (process.env.ESPN_LEAGUE_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

/** True when a Postgres cache is configured. */
export function hasDatabase(): boolean {
  return Boolean(env.databaseUrl);
}

/**
 * ESPN cookie credentials, or null when they are not configured.
 *
 * SWID is a GUID that ESPN expects wrapped in braces. Copying it out of the
 * browser sometimes loses them, and the resulting 401 looks identical to a
 * genuinely expired cookie — so they are put back rather than trusted.
 */
export function espnCredentials(): { espnS2: string; swid: string } | null {
  if (!env.espnS2 || !env.espnSwid) return null;
  const swid = env.espnSwid.startsWith("{") ? env.espnSwid : `{${env.espnSwid}}`;
  return { espnS2: env.espnS2, swid };
}

/** True when ESPN leagues are configured well enough to attempt a read. */
export function hasEspn(): boolean {
  return espnCredentials() !== null && env.espnLeagueIds.length > 0;
}
