import { NextResponse } from "next/server";

import { loadDashboard } from "@/lib/data/dashboard";

export const dynamic = "force-dynamic";

/**
 * The dashboard payload, for the header's refresh button.
 * Read-only — Snap Count never writes back to a fantasy platform.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const weekParam = url.searchParams.get("week");
  const season = url.searchParams.get("season") ?? undefined;

  const week = weekParam ? Number(weekParam) : undefined;
  if (week != null && (!Number.isInteger(week) || week < 1 || week > 18)) {
    return NextResponse.json(
      { error: "week must be an integer between 1 and 18" },
      { status: 400 },
    );
  }

  try {
    const data = await loadDashboard({ week, season });
    return NextResponse.json(data, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
