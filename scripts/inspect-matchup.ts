/**
 * Prints one league's head-to-head to the terminal, so the slot alignment and
 * projection numbers can be checked against Sleeper without a browser.
 *
 *   npx tsx scripts/inspect-matchup.ts Shlong
 */
import "dotenv/config";

import { loadDashboard } from "../src/lib/data/dashboard";
import { buildMatchupDetail, projectedMargin } from "../src/lib/domain/matchup";
import { closeDb } from "../src/lib/db/client";

const needle = (process.argv[2] ?? "").toLowerCase();

async function main() {
  const data = await loadDashboard();

  const team =
    data.teams.find((t) => t.leagueName.toLowerCase().includes(needle)) ??
    data.teams.find((t) => t.matchup);

  if (!team) {
    console.log("No team with a matchup found.");
    return;
  }

  const m = buildMatchupDetail(team);
  if (!m) {
    console.log(`${team.leagueName} has no matchup this week.`);
    return;
  }

  console.log(`=== ${m.leagueName} — week ${m.week} (${data.source}) ===`);
  console.log(
    `${m.mine.name}  proj ${m.mine.projected}   vs   ${m.opponent?.name}  proj ${m.opponent?.projected}`,
  );
  console.log(`projected margin: ${projectedMargin(m)}`);
  console.log(`hasProjections: ${m.hasProjections} | slots: ${m.slots.length}`);
  console.log();
  console.log("  PROJ  MINE                        SLOT         OPPONENT                    PROJ");

  for (const r of m.slots) {
    const mine = r.mine ? `${r.mine.name} (${r.mine.position})` : "Empty";
    const opp = r.opponent ? `${r.opponent.name} (${r.opponent.position})` : "Empty";
    console.log(
      String(r.mine?.projectedPoints ?? "—").padStart(6),
      " ",
      mine.padEnd(27).slice(0, 27),
      r.slot.padEnd(12),
      opp.padEnd(27).slice(0, 27),
      String(r.opponent?.projectedPoints ?? "—").padStart(6),
    );
  }

  console.log();
  console.log(
    `  bench: mine ${m.mine.bench.length}, opponent ${m.opponent?.bench.length ?? 0}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
