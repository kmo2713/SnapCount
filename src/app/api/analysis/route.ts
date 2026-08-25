import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  analyzeLineup,
  analyzeTrade,
  lineupCacheKey,
  tradeCacheKey,
} from "@/lib/ai/analysis";
import { describeAnthropicError, hasAnthropicKey } from "@/lib/ai/client";
import { loadDashboard } from "@/lib/data/dashboard";
import { getDb, schema } from "@/lib/db/client";
import { describeDbError } from "@/lib/db/errors";

export const dynamic = "force-dynamic";
/** Adaptive thinking on a full roster can take a while. */
export const maxDuration = 120;

const RequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lineup"),
    teamId: z.string().min(1),
    /** Skip the cache and pay for a fresh answer. */
    refresh: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("trade"),
    teamId: z.string().min(1),
    opponentTeamId: z.string().min(1),
    outgoingPlayerIds: z.array(z.string()),
    incomingPlayerIds: z.array(z.string()),
    refresh: z.boolean().optional(),
  }),
]);

/** Reads a previous answer for these exact inputs, if we have one. */
async function readCache(cacheKey: string) {
  const db = getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select()
      .from(schema.aiAnalyses)
      .where(eq(schema.aiAnalyses.cacheKey, cacheKey))
      .limit(1);
    return row ?? null;
  } catch {
    // A cache miss and a broken cache should behave the same: just analyse.
    return null;
  }
}

async function writeCache(row: typeof schema.aiAnalyses.$inferInsert) {
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(schema.aiAnalyses).values(row).onConflictDoNothing();
  } catch (err) {
    // Never fail a good answer because we could not memoise it.
    console.warn("Could not cache analysis:", describeDbError(err));
  }
}

export async function POST(request: Request) {
  if (!hasAnthropicKey()) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY is not configured. Snap Count's built-in heuristics still work without it.",
        configured: false,
      },
      { status: 503 },
    );
  }

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid request: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  const data = await loadDashboard();
  const team = data.teams.find((t) => t.id === body.teamId);
  if (!team) {
    return NextResponse.json(
      { error: `No team found with id "${body.teamId}".` },
      { status: 404 },
    );
  }

  try {
    if (body.kind === "lineup") {
      const key = lineupCacheKey(team, data.viewedWeek);
      if (!body.refresh) {
        const hit = await readCache(key);
        if (hit) {
          return NextResponse.json({
            kind: "lineup",
            analysis: hit.payload,
            cached: true,
            model: hit.model,
            generatedAt: hit.createdAt.toISOString(),
          });
        }
      }

      const result = await analyzeLineup(team, data.viewedWeek);
      await writeCache({
        kind: "lineup",
        cacheKey: result.cacheKey,
        season: team.season,
        week: data.viewedWeek,
        payload: result.analysis,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });

      return NextResponse.json({
        kind: "lineup",
        analysis: result.analysis,
        cached: false,
        model: result.model,
        usage: result.usage,
        generatedAt: new Date().toISOString(),
      });
    }

    /* -- trade -- */
    const opponent = team.leagueTeams.find((t) => t.id === body.opponentTeamId);
    if (!opponent) {
      return NextResponse.json(
        { error: "Trade partner is not in this league." },
        { status: 400 },
      );
    }

    const outgoing = team.roster.filter((p) =>
      body.outgoingPlayerIds.includes(p.id),
    );
    const incoming = opponent.roster.filter((p) =>
      body.incomingPlayerIds.includes(p.id),
    );

    if (outgoing.length === 0 && incoming.length === 0) {
      return NextResponse.json(
        { error: "Select at least one player on either side." },
        { status: 400 },
      );
    }

    const sides = { outgoing, incoming, opponentName: opponent.name };
    const key = tradeCacheKey(team, sides, data.viewedWeek);

    if (!body.refresh) {
      const hit = await readCache(key);
      if (hit) {
        return NextResponse.json({
          kind: "trade",
          analysis: hit.payload,
          cached: true,
          model: hit.model,
          generatedAt: hit.createdAt.toISOString(),
        });
      }
    }

    const result = await analyzeTrade(team, sides, data.viewedWeek);
    await writeCache({
      kind: "trade",
      cacheKey: result.cacheKey,
      season: team.season,
      week: data.viewedWeek,
      payload: result.analysis,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });

    return NextResponse.json({
      kind: "trade",
      analysis: result.analysis,
      cached: false,
      model: result.model,
      usage: result.usage,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: describeAnthropicError(err) },
      { status: 500 },
    );
  }
}
