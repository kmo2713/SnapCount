/**
 * ESPN verification — `npm run espn:verify -- --season=2025`.
 *
 * Reconstructs every team's weekly score from the starters we stored and
 * compares it to the score ESPN itself reported. That one number exercises the
 * whole chain at once: the id crosswalk, the lineup-slot map, starter/bench
 * classification, and per-player points parsing. If any of them is wrong the
 * totals stop matching, which is far harder to miss than a roster that merely
 * looks plausible.
 *
 * Point it at a completed season. A pre-draft league stores no rosters, so
 * there is nothing to check against until a league has actually played.
 *
 * Reads only.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/lib/db/client";
import { env } from "../src/lib/env";

/** Points are stored as real; allow for float noise, nothing more. */
const TOLERANCE = 0.02;

function value(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

interface ScoreRow {
  league: string;
  team: string;
  week: number;
  reported: number;
  starterSum: number;
  starters: number;
}

async function main() {
  const season = value("season") ?? env.season ?? String(new Date().getFullYear());
  const db = getDb();
  if (!db) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  console.log(`ESPN verification — season ${season}\n`);

  const rows = (await db.execute(sql`
    select l.name as league, t.name as team, m.week,
           m.points::float8 as reported,
           coalesce(sum(mp.points) filter (where mp.is_starter), 0)::float8 as "starterSum",
           count(*) filter (where mp.is_starter)::int as starters
    from matchups m
    join leagues l on l.id = m.league_id
    join teams t on t.id = m.team_id
    left join matchup_players mp on mp.matchup_id = m.id
    where l.platform = 'espn' and m.season = ${season} and m.points is not null
    group by l.name, t.name, m.week, m.points
    order by m.week, l.name, t.name
  `)) as unknown as ScoreRow[];

  if (rows.length === 0) {
    console.log(
      "No scored ESPN matchups cached for that season.\n" +
        "A pre-draft league stores no rosters, so there is nothing to verify yet.",
    );
    return;
  }

  const failures = rows.filter(
    (r) => Math.abs(r.reported - r.starterSum) >= TOLERANCE,
  );

  for (const r of failures.slice(0, 20)) {
    console.log(
      `  MISMATCH  wk${String(r.week).padStart(2)}  ${r.team.padEnd(28)} ` +
        `ESPN=${r.reported.toFixed(2)}  ours=${r.starterSum.toFixed(2)} ` +
        `(${r.starters} starters, off by ${Math.abs(r.reported - r.starterSum).toFixed(2)})`,
    );
  }
  if (failures.length > 20) {
    console.log(`  …and ${failures.length - 20} more`);
  }

  const passed = rows.length - failures.length;
  console.log(
    `\nstarter totals matching ESPN's own score: ${passed}/${rows.length}`,
  );

  /* Unmapped players are the usual cause of a mismatch, so name them. */
  if (failures.length > 0) {
    console.log(
      "\nA short starting lineup usually means an ESPN player has no canonical\n" +
        "row yet. Re-run `npm run sync -- --espn-ids`, then sync the season again.",
    );
    process.exitCode = 1;
  }

  const [coverage] = (await db.execute(sql`
    select count(*)::int as rows,
           count(mp.points)::int as "withPoints",
           count(mp.projected_points)::int as "withProjection"
    from matchup_players mp
    join matchups m on m.id = mp.matchup_id
    join leagues l on l.id = m.league_id
    where l.platform = 'espn' and m.season = ${season}
  `)) as unknown as Array<{ rows: number; withPoints: number; withProjection: number }>;

  console.log(
    `per-player rows: ${coverage.rows}  with points: ${coverage.withPoints}  ` +
      `with projection: ${coverage.withProjection}`,
  );
}

main()
  .catch((err) => {
    console.error("\nVerification failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
