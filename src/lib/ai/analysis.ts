/**
 * Claude-generated start/sit and trade analysis.
 *
 * This is the layer the brief describes as replacing the heuristic
 * placeholders. It does not delete them — the heuristics still run, are still
 * shown, and are still what you get with no API key. What Claude adds is the
 * part a value comparison cannot do: weighing an injury designation against a
 * bye, noticing that a flex slot is really a matchup call, and saying when the
 * decision is genuinely too close to matter.
 *
 * Cost discipline is deliberate. Nothing here runs on page load; every call is
 * user-triggered, results are cached on a hash of the exact inputs, and the
 * stable framing lives in a cached system prompt so repeat calls only pay for
 * the roster that changed.
 */
import { createHash } from "node:crypto";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { lineupFlags, playerValue } from "@/lib/domain/analytics";
import { buildMatchupDetail } from "@/lib/domain/matchup";
import type { MyTeam, RosterPlayer } from "@/lib/domain/types";
import { ANALYSIS_MODEL, getAnthropic } from "./client";
import {
  LineupAnalysisSchema,
  TradeAnalysisSchema,
  type LineupAnalysis,
  type TradeAnalysis,
} from "./schemas";

export interface AnalysisResult<T> {
  analysis: T;
  model: string;
  cacheKey: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Framing that never changes between requests, so it stays a cache hit.
 *
 * The tone instructions matter as much as the task: an assistant that always
 * finds something to recommend is worse than useless for start/sit, where the
 * correct answer is usually "your lineup is fine".
 */
const SYSTEM_PROMPT = `You are a fantasy football analyst inside Snap Count, a read-only dashboard.

Ground rules:
- Recommend a change only when it is genuinely better. Most set lineups are already correct; returning an empty recommendation list is a good answer, not a failure.
- Reason from the data you are given. You do not have live news, weather, or Vegas lines — do not pretend otherwise or invent injury reports.
- Projections come from Rotowire, already scored against this league's own scoring settings. Treat them as a strong signal but not gospel; a projection gap under about 1.5 points is noise.
- A player on bye scores zero. A player ruled Out scores zero. These outrank any projection gap.
- Respect lineup eligibility: only suggest a swap into a slot the player can legally fill.
- Be concise and specific. Name players and numbers. No hedging boilerplate, no restating the question.
- The user cannot make changes here — Snap Count is read-only and they act in Sleeper. Do not tell them to click anything in this app.`;

/** Compact one player onto a single line — cheaper and easier to read. */
function describePlayer(p: RosterPlayer, includeSlot = false): string {
  const bits: string[] = [];
  if (includeSlot && p.slotPosition) bits.push(`[${p.slotPosition}]`);
  bits.push(`${p.name} (${p.position}${p.nflTeam ? `, ${p.nflTeam}` : ""})`);
  bits.push(p.projectedPoints != null ? `proj ${p.projectedPoints}` : "proj —");
  if (p.status && p.status !== "Active") bits.push(`STATUS: ${p.status}`);
  if (p.byeWeek != null) bits.push(`bye W${p.byeWeek}`);
  // Only send a scoring average once there is actual scoring. In preseason
  // every player reads "avg 0 over 1w", which is not a signal — it is noise
  // that invites the model to conclude nobody is producing.
  if (p.seasonAvgPoints != null && p.seasonSamples > 0 && p.seasonAvgPoints > 0) {
    bits.push(`avg ${p.seasonAvgPoints} over ${p.seasonSamples}w`);
  }
  if (p.searchRank != null && p.searchRank < 100_000) {
    bits.push(`rank ${p.searchRank}`);
  }
  return bits.join(" · ");
}

/** Describes the league's scoring in the terms an analyst would use. */
function describeScoring(team: MyTeam): string {
  return [
    `${team.totalRosters}-team`,
    `lineup: ${team.startingSlots.join(", ")}`,
  ].join(" · ");
}

/** Stable hash of everything that could change the answer. */
function hashInputs(parts: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 32);
}

/* -------------------------------------------------------------------------
   Lineup / start-sit
   ------------------------------------------------------------------------- */

export function lineupCacheKey(team: MyTeam, week: number): string {
  return hashInputs([
    "lineup-v1",
    team.id,
    week,
    // Any change to who is starting, their status, or their projection should
    // invalidate — nothing else should.
    team.roster
      .map((p) => [p.id, p.slotPosition, p.kind, p.status, p.projectedPoints])
      .sort(),
  ]);
}

export async function analyzeLineup(
  team: MyTeam,
  week: number,
): Promise<AnalysisResult<LineupAnalysis>> {
  const client = getAnthropic();
  if (!client) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const starters = [...team.starters].sort(
    (a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0),
  );
  const bench = team.bench.filter((p) => p.kind === "bench");
  const detail = buildMatchupDetail(team);
  const heuristics = lineupFlags(team);

  const lines: string[] = [
    `League: ${team.leagueName} — ${describeScoring(team)}`,
    `Team: ${team.teamName} (${team.record})`,
    `Week ${week}.`,
    "",
    "STARTING LINEUP:",
    ...starters.map((p) => `  ${describePlayer(p, true)}`),
    "",
    "BENCH:",
    ...(bench.length > 0
      ? bench.map((p) => `  ${describePlayer(p)}`)
      : ["  (empty)"]),
  ];

  if (detail?.opponent) {
    lines.push(
      "",
      `OPPONENT: ${detail.opponent.name} (${detail.opponent.record}), projected ${
        detail.opponent.projected ?? "—"
      } vs your projected ${detail.mine.projected ?? "—"}.`,
    );
  }

  if (heuristics.length > 0) {
    lines.push(
      "",
      "The dashboard's own value heuristic flagged these — verify or dismiss them, it is crude:",
      ...heuristics.map(
        (f) => `  ${f.replacement.name} over ${f.starter.name} at ${f.starter.slotPosition} (${f.reason})`,
      ),
    );
  }

  const response = await client.messages.parse({
    model: ANALYSIS_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: lines.join("\n") }],
    output_config: { format: zodOutputFormat(LineupAnalysisSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Claude returned no parseable analysis.");

  return {
    analysis: parsed,
    model: response.model,
    cacheKey: lineupCacheKey(team, week),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

/* -------------------------------------------------------------------------
   Trade
   ------------------------------------------------------------------------- */

export interface TradeSides {
  outgoing: RosterPlayer[];
  incoming: RosterPlayer[];
  opponentName: string;
}

export function tradeCacheKey(
  team: MyTeam,
  sides: TradeSides,
  week: number,
): string {
  return hashInputs([
    "trade-v1",
    team.id,
    week,
    sides.opponentName,
    sides.outgoing.map((p) => p.id).sort(),
    sides.incoming.map((p) => p.id).sort(),
  ]);
}

export async function analyzeTrade(
  team: MyTeam,
  sides: TradeSides,
  week: number,
): Promise<AnalysisResult<TradeAnalysis>> {
  const client = getAnthropic();
  if (!client) throw new Error("ANTHROPIC_API_KEY is not configured.");

  /** Positional depth after the trade, so Claude can see the real effect. */
  const outIds = new Set(sides.outgoing.map((p) => p.id));
  const after = [
    ...team.roster.filter((p) => !outIds.has(p.id)),
    ...sides.incoming,
  ];
  const depth = (roster: RosterPlayer[]) =>
    ["QB", "RB", "WR", "TE"]
      .map((pos) => {
        const at = roster.filter((p) => p.position === pos);
        const total = at.reduce((s, p) => s + playerValue(p), 0);
        return `${pos} ${at.length} (value ${Math.round(total)})`;
      })
      .join(", ");

  const lines = [
    `League: ${team.leagueName} — ${describeScoring(team)}`,
    `Team: ${team.teamName} (${team.record}), week ${week}.`,
    "",
    `${team.teamName} SENDS:`,
    ...(sides.outgoing.length > 0
      ? sides.outgoing.map((p) => `  ${describePlayer(p)}`)
      : ["  (nothing)"]),
    "",
    `${sides.opponentName} SENDS:`,
    ...(sides.incoming.length > 0
      ? sides.incoming.map((p) => `  ${describePlayer(p)}`)
      : ["  (nothing)"]),
    "",
    `Positional depth now:   ${depth(team.roster)}`,
    `Positional depth after: ${depth(after)}`,
    "",
    "Current starting lineup for context:",
    ...team.starters
      .sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0))
      .map((p) => `  ${describePlayer(p, true)}`),
    "",
    "Judge this from the perspective of " + team.teamName + ".",
  ];

  const response = await client.messages.parse({
    model: ANALYSIS_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: lines.join("\n") }],
    output_config: { format: zodOutputFormat(TradeAnalysisSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Claude returned no parseable analysis.");

  return {
    analysis: parsed,
    model: response.model,
    cacheKey: tradeCacheKey(team, sides, week),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
