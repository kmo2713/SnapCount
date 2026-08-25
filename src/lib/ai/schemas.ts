import { z } from "zod";

/**
 * Structured shapes for Claude's analysis.
 *
 * These are the contract between the model and the UI: the views render these
 * fields directly, so the schema is what stops a free-text answer from turning
 * into a parsing problem. Every recommendation carries its own confidence and
 * reasoning, because "start X over Y" without a why is not actionable — and an
 * honest "this is close" is more useful than false certainty.
 */

export const LineupRecommendationSchema = z.object({
  /** Player to move into the lineup. */
  startPlayer: z.string(),
  /** Player to move out. */
  sitPlayer: z.string(),
  /** Lineup slot the swap applies to, e.g. "FLEX" or "SUPER_FLEX". */
  slot: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  /** One or two sentences a human would actually say. */
  reasoning: z.string(),
});

export const LineupAnalysisSchema = z.object({
  /** Two or three sentences on the lineup as a whole. */
  summary: z.string(),
  /** Ordered by impact. Empty when the lineup is already correct. */
  recommendations: z.array(LineupRecommendationSchema),
  /** Players worth watching this week without a firm recommendation. */
  watchList: z.array(
    z.object({
      player: z.string(),
      concern: z.string(),
    }),
  ),
  /** Overall read on the matchup, when one exists. */
  matchupOutlook: z.string(),
});

export type LineupAnalysis = z.infer<typeof LineupAnalysisSchema>;
export type LineupRecommendation = z.infer<typeof LineupRecommendationSchema>;

export const TradeAnalysisSchema = z.object({
  /** "accept" | "decline" | "counter" | "close" — the headline call. */
  verdict: z.enum(["accept", "decline", "counter", "close"]),
  confidence: z.enum(["high", "medium", "low"]),
  /** Two or three sentences explaining the verdict. */
  summary: z.string(),
  /** What the proposing side gains. */
  yourGains: z.array(z.string()),
  /** What the proposing side gives up. */
  yourLosses: z.array(z.string()),
  /** Concrete adjustment when the verdict is "counter". */
  suggestedCounter: z.string().nullable(),
  /** How the trade changes positional depth. */
  rosterImpact: z.string(),
});

export type TradeAnalysis = z.infer<typeof TradeAnalysisSchema>;
