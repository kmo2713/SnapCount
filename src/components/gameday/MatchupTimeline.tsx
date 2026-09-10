"use client";

/**
 * One matchup's win probability across the day, with the moves that made it.
 *
 * The same idea as the win-probability chart in the NFL drill-in, for the
 * thing you actually care about. A football game's chart moves for one game's
 * reasons; yours moves for eight games' at once, which is exactly the view no
 * other app can give you.
 *
 * Loaded on open rather than with the poll: it reads the whole day out of
 * Postgres and nothing about it changes between two five-minute samples.
 */
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Loading } from "@/components/ui/primitives";
import type { TimelinePoint } from "@/lib/domain/matchup-timeline";

interface TimelineResponse {
  points: TimelinePoint[];
  swings: TimelinePoint[];
  samples: number;
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** A signed percentage-point move. */
const swingLabel = (swing: number) =>
  `${swing > 0 ? "+" : swing < 0 ? "−" : ""}${Math.abs(Math.round(swing))}`;

export function MatchupTimeline({
  leagueId,
  week,
}: {
  leagueId: string;
  week: number;
}) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`/api/gameday/timeline?week=${week}&leagueId=${leagueId}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | (TimelineResponse & { error?: string })
          | null;
        if (cancelled) return;
        if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
        setData(body as TimelineResponse);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [leagueId, week]);

  if (error) {
    return <div className="sc-note">{error}</div>;
  }

  if (!data) return <Loading label="Loading the day" />;

  /*
   * Two samples is the minimum that draws a line rather than a dot, and the
   * distinction between "nothing recorded" and "one league had not started"
   * is worth telling the reader, because only one of them is their problem.
   */
  if (data.points.length < 2) {
    return (
      <div className="sc-note" style={{ marginBottom: 0 }}>
        {data.samples === 0
          ? "Nothing recorded for this week yet. The timeline is written by the scheduled sync every five minutes — it fills in on its own once that is running."
          : `Only ${data.points.length} of ${data.samples} samples have a probability for this league so far. The line appears once there are two.`}
      </div>
    );
  }

  return (
    <div>
      <div style={{ height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data.points}
            margin={{ top: 6, right: 6, bottom: 0, left: -24 }}
          >
            <CartesianGrid stroke="var(--sc-border-soft)" vertical={false} />
            {/* Even money, so a glance says which side of it you are on. */}
            <ReferenceLine y={50} stroke="var(--sc-border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="at"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={clock}
              tick={{ fill: "var(--sc-text-muted)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
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
              labelFormatter={(at) => clock(Number(at))}
              formatter={(value, _name, item) => {
                const point = item?.payload as TimelinePoint | undefined;
                const score = point
                  ? ` (${point.myScore.toFixed(1)}${
                      point.opponentScore != null
                        ? `–${point.opponentScore.toFixed(1)}`
                        : ""
                    })`
                  : "";
                return [`${Math.round(Number(value))}%${score}`, "Win chance"];
              }}
            />
            <Line
              type="monotone"
              dataKey="winPct"
              stroke="var(--sc-accent)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {data.swings.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="sc-section-title" style={{ marginBottom: 6 }}>
            Biggest moves
          </div>
          {/*
            Named, not explained. The samples know the probability moved, by how
            much, and which NFL games changed score in that five minutes. They
            do not know which play did it — a fantasy swing comes off a stat
            line and a five-minute sample holds no plays — so this reports what
            it can stand behind and stops there.
          */}
          {data.swings.map((swing) => (
            <div key={swing.at} className="sc-swing">
              <span
                className="sc-mono sc-swing-value"
                data-effect={swing.swing > 0 ? "help" : "hurt"}
              >
                {swingLabel(swing.swing)}
              </span>
              <span className="sc-mono sc-swing-time">{clock(swing.at)}</span>
              <span className="sc-swing-detail">
                you {swing.myGain >= 0 ? "+" : "−"}
                {Math.abs(swing.myGain).toFixed(1)}
                {swing.opponentGain !== 0 && (
                  <>
                    , them {swing.opponentGain >= 0 ? "+" : "−"}
                    {Math.abs(swing.opponentGain).toFixed(1)}
                  </>
                )}
                {swing.movedGames.length > 0 && (
                  <span style={{ color: "var(--sc-text-muted)" }}>
                    {" "}
                    · {swing.movedGames.slice(0, 3).join(", ")}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
