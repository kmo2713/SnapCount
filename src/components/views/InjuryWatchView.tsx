"use client";

/**
 * Injury Watch — every non-active player you roster anywhere, starters first.
 * Statuses are Sleeper's live injury designations, refreshed on every sync.
 */
import { useMemo } from "react";
import { HeartPulse } from "lucide-react";

import { INJURY_SEVERITY } from "@/lib/domain/positions";
import type { DashboardData, RosterPlayer } from "@/lib/domain/types";
import {
  EmptyState,
  PlatformBadge,
  PlayerName,
  PosTag,
  StatusTag,
} from "@/components/ui/primitives";

interface Row extends RosterPlayer {
  rowId: string;
  teamName: string;
  leagueName: string;
  platform: DashboardData["teams"][number]["platform"];
}

export function InjuryWatchView({ data }: { data: DashboardData }) {
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const t of data.teams) {
      for (const p of t.roster) {
        if (p.status === "Active") continue;
        out.push({
          ...p,
          rowId: `${t.id}:${p.id}`,
          teamName: t.teamName,
          leagueName: t.leagueName,
          platform: t.platform,
        });
      }
    }
    return out.sort(
      (a, b) =>
        Number(b.starter) - Number(a.starter) ||
        (INJURY_SEVERITY[b.status] ?? 0) - (INJURY_SEVERITY[a.status] ?? 0) ||
        a.name.localeCompare(b.name),
    );
  }, [data.teams]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={HeartPulse}
        title="No injuries flagged"
        body="Every rostered player across your teams is currently listed active."
      />
    );
  }

  const startersHit = rows.filter((r) => r.starter).length;

  return (
    <div>
      <p className="sc-note">
        Every non-active player across all your teams, starters first.{" "}
        {startersHit} of these {startersHit === 1 ? "is" : "are"} currently in a
        starting lineup.
      </p>

      <div className="sc-table-scroll">
        <table className="sc-table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Player</th>
              <th>NFL team</th>
              <th>Status</th>
              <th>Detail</th>
              <th>Role</th>
              <th>Fantasy team</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowId}>
                <td>
                  <PosTag pos={r.position} />
                </td>
                <td>
                  <PlayerName name={r.name} nickname={r.nickname} />
                </td>
                <td style={{ color: "var(--sc-text-muted)" }}>{r.nflTeam || "—"}</td>
                <td>
                  <StatusTag status={r.status} />
                </td>
                <td style={{ color: "var(--sc-text-muted)", fontSize: 12 }}>
                  {r.injuryBodyPart ?? "—"}
                </td>
                <td>
                  {r.starter ? (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--sc-accent)",
                      }}
                    >
                      STARTING · {r.slotPosition}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
                      {r.kind === "ir" ? "IR" : r.kind === "taxi" ? "Taxi" : "Bench"}
                    </span>
                  )}
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <PlatformBadge platform={r.platform} />
                    <span
                      className="sc-truncate"
                      style={{
                        fontSize: 11,
                        color: "var(--sc-text-muted)",
                        maxWidth: 180,
                      }}
                    >
                      {r.teamName}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
