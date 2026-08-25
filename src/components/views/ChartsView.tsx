"use client";

/**
 * Charts — weekly scoring trend, points-for by team, and roster position mix.
 * All three run on real synced data, so they empty out honestly before kickoff
 * rather than plotting generated numbers.
 */
import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { defaultTeam } from "@/lib/domain/analytics";
import { posColor } from "@/lib/domain/positions";
import type { DashboardData } from "@/lib/domain/types";
import { EmptyState } from "@/components/ui/primitives";

const TOOLTIP_STYLE = {
  background: "var(--sc-surface-raised)",
  border: "1px solid var(--sc-border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--sc-text)",
};

export function ChartsView({ data }: { data: DashboardData }) {
  const [teamId, setTeamId] = useState<string | null>(null);

  const activeTeam =
    data.teams.find((t) => t.id === teamId) ?? defaultTeam(data.teams) ?? null;

  const teamPointsBar = useMemo(
    () =>
      data.teams
        .map((t) => ({
          name: t.teamName,
          pointsFor: Number(t.pointsFor.toFixed(1)),
          pointsAgainst: Number(t.pointsAgainst.toFixed(1)),
        }))
        .sort((a, b) => b.pointsFor - a.pointsFor),
    [data.teams],
  );

  const posBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of data.teams) {
      for (const p of t.roster) {
        counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([position, count]) => ({ position, count }))
      .sort((a, b) => b.count - a.count);
  }, [data.teams]);

  if (data.teams.length === 0) {
    return <EmptyState icon={BarChart3} title="No data" body="Nothing to chart yet." />;
  }

  const weekly = (activeTeam?.weeklyPoints ?? []).filter((w) => w.points != null);
  const anyPoints = teamPointsBar.some((t) => t.pointsFor > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      <section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>
            Weekly points
          </h2>
          {data.teams.length > 1 && (
            <select
              className="sc-select"
              value={activeTeam?.id ?? ""}
              onChange={(e) => setTeamId(e.target.value)}
              aria-label="Choose a team"
            >
              {data.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.teamName} — {t.leagueName}
                </option>
              ))}
            </select>
          )}
        </div>

        {weekly.length > 0 ? (
          <div style={{ width: "100%", height: 250 }}>
            <ResponsiveContainer>
              <LineChart data={weekly}>
                <CartesianGrid stroke="var(--sc-border)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--sc-text-muted)" fontSize={12} />
                <YAxis stroke="var(--sc-text-muted)" fontSize={12} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "var(--sc-border)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="points"
                  name="You"
                  stroke="#F2A63D"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="opponentPoints"
                  name="Opponent"
                  stroke="#5B6472"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={{ r: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            icon={BarChart3}
            title="No scoring yet"
            body="This chart fills in once week 1 has been played."
          />
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 10px" }}>
          Points for and against, by team
        </h2>
        {anyPoints ? (
          <div style={{ width: "100%", height: Math.max(220, teamPointsBar.length * 42) }}>
            <ResponsiveContainer>
              <BarChart data={teamPointsBar} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid stroke="var(--sc-border)" horizontal={false} />
                <XAxis type="number" stroke="var(--sc-text-muted)" fontSize={12} />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="var(--sc-text-muted)"
                  fontSize={11}
                  width={140}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#ffffff08" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="pointsFor" name="Points for" fill="#4C9A5B" radius={[0, 4, 4, 0]} />
                <Bar
                  dataKey="pointsAgainst"
                  name="Points against"
                  fill="#3A4450"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            icon={BarChart3}
            title="No points recorded"
            body="Season totals appear here once games are played."
          />
        )}
      </section>

      {posBreakdown.length > 0 && (
        <section>
          <h2 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 10px" }}>
            Roster position mix, all teams
          </h2>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={posBreakdown}
                  dataKey="count"
                  nameKey="position"
                  outerRadius={95}
                  label={({ name }) => String(name ?? "")}
                >
                  {posBreakdown.map((entry) => (
                    <Cell key={entry.position} fill={posColor(entry.position)} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}
