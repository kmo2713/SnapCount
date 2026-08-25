/** Mirrors the prompt shape in src/lib/ai/analysis.ts closely enough to size it. */
import type { MyTeam, RosterPlayer } from "../src/lib/domain/types";

/** Length of the fixed system prompt, which is cached after the first call. */
export const SYSTEM_PROMPT_CHARS = 1150;

function playerLine(p: RosterPlayer): string {
  const bits = [
    `[${p.slotPosition}] ${p.name} (${p.position}, ${p.nflTeam})`,
    p.projectedPoints != null ? `proj ${p.projectedPoints}` : "proj —",
    p.status !== "Active" ? `STATUS: ${p.status}` : "",
    p.byeWeek != null ? `bye W${p.byeWeek}` : "",
    p.seasonAvgPoints != null ? `avg ${p.seasonAvgPoints} over ${p.seasonSamples}w` : "",
    p.searchRank != null ? `rank ${p.searchRank}` : "",
  ].filter(Boolean);
  return "  " + bits.join(" · ") + "\n";
}

export function estimateLineupPromptChars(team: MyTeam): number {
  const header = `League: ${team.leagueName} — ${team.totalRosters}-team · lineup: ${team.startingSlots.join(", ")}\nTeam: ${team.teamName} (${team.record})\nWeek N.\n\nSTARTING LINEUP:\nBENCH:\nOPPONENT: ... projected\n`;
  const rows = team.roster.map(playerLine).join("");
  return header.length + rows.length;
}
