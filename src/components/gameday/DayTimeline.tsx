"use client";

/**
 * How the day went.
 *
 * Reads the snapshots the cron writer records, which is why this is the one
 * part of game day that is not live: it is a record, and a record only exists
 * if something was writing it. If the scheduled sync is not running there is
 * nothing here, and the empty state says so plainly rather than drawing an
 * empty chart and letting you wonder.
 *
 * One line per league, tracing your own team's score through the afternoon.
 */
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Loading } from "@/components/ui/primitives";

/** One sample, flattened to "my score in each league at this moment". */
interface TimelineRow {
  label: string;
  [leagueName: string]: string | number;
}

interface TimelineResponse {
  leagues: string[];
  rows: TimelineRow[];
}

/**
 * Enough visually distinct lines for nine leagues, drawn from the palette
 * already in `globals.css` rather than inventing new colours.
 */
const LINE_COLORS = [
  "var(--sc-accent)",
  "var(--sc-cyan)",
  "var(--sc-green)",
  "var(--sc-purple)",
  "var(--sc-orange)",
  "var(--sc-red)",
  "#7fa7d4",
  "#c9a227",
  "#8fbf9f",
];

export function DayTimeline({ week }: { week: number }) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/gameday/timeline?week=${week}`, { cache: "no-store" })
      .then(async (res) => {
        // Parse defensively and only after checking status: a 500 that returns
        // an HTML error page would otherwise surface as "Unexpected token <".
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (cancelled) return;
        if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
        setData(body as TimelineResponse);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [week]);

  if (error) {
    return <div className="sc-note">Timeline unavailable: {error}</div>;
  }

  if (!data) return <Loading label="Loading the day" />;

  if (data.rows.length < 2) {
    return (
      <div className="sc-note">
        No day recorded yet. The timeline is written by the scheduled sync
        (<code>/api/sync?scope=live</code>) on its game-day cadence, so it fills in once
        that is running — opening this page does not record anything, deliberately.
      </div>
    );
  }

  return (
    <div style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--sc-border-soft)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--sc-text-muted)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: "var(--sc-text-muted)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--sc-surface-raised)",
              border: "1px solid var(--sc-border)",
              borderRadius: 8,
              fontSize: 11,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {data.leagues.map((league, i) => (
            <Line
              key={league}
              type="monotone"
              dataKey={league}
              stroke={LINE_COLORS[i % LINE_COLORS.length]}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
