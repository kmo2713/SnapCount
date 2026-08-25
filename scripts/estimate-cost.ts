/**
 * Estimates what a Claude analysis costs against your real rosters.
 *
 * Token counts are approximated from character length (~3.7 chars/token for
 * this dense name-and-number text) because an exact count needs an API call,
 * and the point of this script is to tell you the price *before* you spend.
 * The genuinely unpredictable part is thinking tokens, so it brackets a range.
 */
import "dotenv/config";

import { loadDashboard } from "../src/lib/data/dashboard";
import { SYSTEM_PROMPT_CHARS, estimateLineupPromptChars } from "./cost-helpers";
import { closeDb } from "../src/lib/db/client";

/** Claude Opus 5, per 1M tokens. */
const INPUT_PER_TOKEN = 5.0 / 1_000_000;
const OUTPUT_PER_TOKEN = 25.0 / 1_000_000;
const CHARS_PER_TOKEN = 3.7;

const toTokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);
const usd = (n: number) => `$${n.toFixed(4)}`;

async function main() {
  const data = await loadDashboard();
  const withRosters = data.teams.filter((t) => t.roster.length > 0);

  console.log(`Season ${data.state.season}, week ${data.viewedWeek} · ${withRosters.length} teams with rosters\n`);
  console.log("  TEAM                       ROSTER  PROMPT CHARS  ~INPUT TOK");

  let totalInput = 0;
  for (const team of withRosters) {
    const chars = estimateLineupPromptChars(team) + SYSTEM_PROMPT_CHARS;
    const tok = toTokens(chars);
    totalInput += tok;
    console.log(
      "  " +
        team.teamName.padEnd(26).slice(0, 26) +
        String(team.roster.length).padStart(5) +
        String(chars).padStart(14) +
        String(tok).padStart(12),
    );
  }

  const avgInput = Math.round(totalInput / Math.max(1, withRosters.length));

  console.log("\n--- per lineup analysis ---");
  console.log(`  input tokens (avg)      ~${avgInput}`);
  console.log(`  input cost              ${usd(avgInput * INPUT_PER_TOKEN)}`);
  console.log();
  console.log("  Output is thinking + the structured answer, and thinking is the");
  console.log("  variable that cannot be predicted without a live call:");
  for (const out of [1500, 3000, 5000]) {
    const cost = avgInput * INPUT_PER_TOKEN + out * OUTPUT_PER_TOKEN;
    console.log(`    ${String(out).padStart(5)} output tok  ->  ${usd(cost)} per analysis`);
  }

  const mid = avgInput * INPUT_PER_TOKEN + 3000 * OUTPUT_PER_TOKEN;
  console.log("\n--- realistic usage (midpoint) ---");
  console.log(`  all ${withRosters.length} lineups once            ${usd(mid * withRosters.length)}`);
  console.log(`  all ${withRosters.length} lineups weekly, 18 wks  ${usd(mid * withRosters.length * 18)}`);
  console.log(`  + ~3 trade reads a week      ${usd(mid * 3 * 18)}`);
  console.log("\n  Cached repeats are free — re-opening an unchanged lineup costs nothing.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeDb);
