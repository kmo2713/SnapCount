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
};

/** True when a Postgres cache is configured. */
export function hasDatabase(): boolean {
  return Boolean(env.databaseUrl);
}
