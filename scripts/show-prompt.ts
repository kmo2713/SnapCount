/** Prints the exact user message that would be sent for one team's lineup. */
import "dotenv/config";
import { loadDashboard } from "../src/lib/data/dashboard";
import { lineupFlags } from "../src/lib/domain/analytics";
import { buildMatchupDetail } from "../src/lib/domain/matchup";
import { closeDb } from "../src/lib/db/client";
import type { RosterPlayer } from "../src/lib/domain/types";

const needle = (process.argv[2] ?? "").toLowerCase();

function describePlayer(p: RosterPlayer, includeSlot = false): string {
  const bits: string[] = [];
  if (includeSlot && p.slotPosition) bits.push(`[${p.slotPosition}]`);
  bits.push(`${p.name} (${p.position}${p.nflTeam ? `, ${p.nflTeam}` : ""})`);
  bits.push(p.projectedPoints != null ? `proj ${p.projectedPoints}` : "proj —");
  if (p.status && p.status !== "Active") bits.push(`STATUS: ${p.status}`);
  if (p.byeWeek != null) bits.push(`bye W${p.byeWeek}`);
  if (p.seasonAvgPoints != null && p.seasonSamples > 0 && p.seasonAvgPoints > 0) {
    bits.push(`avg ${p.seasonAvgPoints} over ${p.seasonSamples}w`);
  }
  if (p.searchRank != null && p.searchRank < 100_000) bits.push(`rank ${p.searchRank}`);
  return bits.join(" · ");
}

async function main() {
  const data = await loadDashboard();
  const team =
    data.teams.find((t) => t.teamName.toLowerCase().includes(needle)) ??
    data.teams.find((t) => t.roster.length > 0)!;
  const week = data.viewedWeek;

  const starters = [...team.starters].sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
  const bench = team.bench.filter((p) => p.kind === "bench");
  const detail = buildMatchupDetail(team);
  const heuristics = lineupFlags(team);

  const lines: string[] = [
    `League: ${team.leagueName} — ${team.totalRosters}-team · lineup: ${team.startingSlots.join(", ")}`,
    `Team: ${team.teamName} (${team.record})`,
    `Week ${week}.`,
    "",
    "STARTING LINEUP:",
    ...starters.map((p) => `  ${describePlayer(p, true)}`),
    "",
    "BENCH:",
    ...(bench.length > 0 ? bench.map((p) => `  ${describePlayer(p)}`) : ["  (empty)"]),
  ];
  if (detail?.opponent) {
    lines.push("", `OPPONENT: ${detail.opponent.name} (${detail.opponent.record}), projected ${detail.opponent.projected ?? "—"} vs your projected ${detail.mine.projected ?? "—"}.`);
  }
  if (heuristics.length > 0) {
    lines.push("", "The dashboard's own value heuristic flagged these — verify or dismiss them, it is crude:",
      ...heuristics.map((f) => `  ${f.replacement.name} over ${f.starter.name} at ${f.starter.slotPosition} (${f.reason})`));
  }
  console.log(lines.join("\n"));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(closeDb);
