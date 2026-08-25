/**
 * CLI sync — `npm run sync`.
 *
 * Flags:
 *   --live       current-week scores only (~1s) — the game-day fast path
 *   --players    refresh the 15MB Sleeper player dump (implied on first run)
 *   --schedule   re-pull bye weeks from ESPN's public scoreboard
 *   --espn-ids   rebuild the ESPN -> canonical player crosswalk
 *   --season=X   sync a season other than the current one
 *   --week=N     limit matchup pulls to weeks 1..N
 */
import "dotenv/config";

import { closeDb } from "../src/lib/db/client";
import { syncAll, syncLiveScores, type SyncResult } from "../src/lib/data/sync";
import { hasDatabase } from "../src/lib/env";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function value(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

async function main() {
  if (!hasDatabase()) {
    console.error(
      "DATABASE_URL is not set.\n" +
        "Copy .env.example to .env, point it at your Postgres/Supabase instance,\n" +
        "then run `npm run db:push` before syncing.",
    );
    process.exit(1);
  }

  const week = value("week") ? Number(value("week")) : undefined;
  const weeks =
    week != null ? Array.from({ length: week }, (_, i) => i + 1) : undefined;

  const live = flag("live");
  console.log(`Snap Count ${live ? "live-score" : "sync"} starting…`);
  const started = Date.now();

  const results: SyncResult[] = live
    ? [await syncLiveScores(value("season"), week)]
    : await syncAll({
        includePlayers: flag("players"),
        includeSchedule: flag("schedule"),
        includeEspnIds: flag("espn-ids"),
        season: value("season"),
        weeks,
      });

  for (const r of results) {
    const stats = Object.entries(r.stats)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(`  ${r.scope.padEnd(9)} ${String(r.durationMs).padStart(6)}ms  ${stats}`);
    for (const w of r.warnings) console.warn(`    ! ${w}`);
  }

  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((err) => {
    console.error("\nSync failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
