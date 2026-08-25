"use client";

/**
 * Standings — the full table for every league you are in, not just your row.
 * Backed by real opponent records now, so ranks match what each platform shows.
 */
import { ListOrdered } from "lucide-react";

import { sortStandings } from "@/lib/domain/analytics";
import type { DashboardData } from "@/lib/domain/types";
import { EmptyState, PlatformBadge, fmt } from "@/components/ui/primitives";

export function StandingsView({ data }: { data: DashboardData }) {
  if (data.teams.length === 0) {
    return (
      <EmptyState icon={ListOrdered} title="No leagues yet" body="Nothing to show." />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {data.teams.map((team) => {
        const rows = sortStandings(team.leagueTeams);
        const played = rows.some((r) => r.wins + r.losses + r.ties > 0);

        return (
          <section key={team.id}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
                flexWrap: "wrap",
              }}
            >
              <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>
                {team.leagueName}
              </h2>
              <PlatformBadge platform={team.platform} />
              {!played && (
                <span style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
                  season hasn&apos;t started — ordered by points for
                </span>
              )}
            </div>

            <div className="sc-table-scroll">
              <table className="sc-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Team</th>
                    <th>Manager</th>
                    <th>Record</th>
                    <th style={{ textAlign: "right" }}>Points for</th>
                    <th style={{ textAlign: "right" }}>Points against</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.id}
                      style={r.isMine ? { background: "var(--sc-accent-soft)" } : undefined}
                    >
                      <td className="sc-mono">{i + 1}</td>
                      <td
                        style={{
                          fontWeight: r.isMine ? 700 : 500,
                          color: r.isMine ? "var(--sc-accent)" : "var(--sc-text)",
                        }}
                      >
                        {r.name}
                        {r.isMine && " (you)"}
                      </td>
                      <td style={{ color: "var(--sc-text-muted)", fontSize: 12 }}>
                        {r.ownerName ?? "—"}
                      </td>
                      <td className="sc-mono">{r.record}</td>
                      <td
                        className="sc-mono"
                        style={{ textAlign: "right", color: "var(--sc-text-muted)" }}
                      >
                        {fmt(r.pointsFor)}
                      </td>
                      <td
                        className="sc-mono"
                        style={{ textAlign: "right", color: "var(--sc-text-muted)" }}
                      >
                        {fmt(r.pointsAgainst)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
