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
  FormatBadge,
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
  leagueFormat: DashboardData["teams"][number]["leagueFormat"];
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
          leagueFormat: t.leagueFormat,
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
              {/*
                Seven columns need 750px, and a phone has 362. Status is the
                only one that survives beside the player — whether he is
                starting for you, where, and what the knock is all fold under
                the name, which is also where they read best.
              */}
              <th>Pos</th>
              <th>Player</th>
              <th className="sc-col-optional">NFL team</th>
              <th>Status</th>
              <th className="sc-col-optional">Detail</th>
              <th className="sc-col-optional">Role</th>
              <th className="sc-col-optional">Fantasy team</th>
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
                  {/*
                    The four dropped columns. Whether he is in your lineup leads,
                    because that is the question this view exists to answer.
                  */}
                  <span className="sc-cell-sub">
                    <span
                      style={{
                        color: r.starter ? "var(--sc-accent)" : undefined,
                        fontWeight: r.starter ? 700 : 400,
                      }}
                    >
                      {r.starter
                        ? `STARTING · ${r.slotPosition}`
                        : r.kind === "ir"
                          ? "IR"
                          : r.kind === "taxi"
                            ? "Taxi"
                            : "Bench"}
                    </span>
                    {" · "}
                    {r.nflTeam || "—"}
                    {r.injuryBodyPart ? ` · ${r.injuryBodyPart}` : ""}
                    {` · ${r.teamName}`}
                  </span>
                </td>
                <td className="sc-col-optional" style={{ color: "var(--sc-text-muted)" }}>
                  {r.nflTeam || "—"}
                </td>
                <td>
                  <StatusTag status={r.status} />
                </td>
                <td
                  className="sc-col-optional"
                  style={{ color: "var(--sc-text-muted)", fontSize: 12 }}
                >
                  {r.injuryBodyPart ?? "—"}
                </td>
                <td className="sc-col-optional">
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
                <td className="sc-col-optional">
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <FormatBadge format={r.leagueFormat} compact />
                    <PlatformBadge platform={r.platform} compact />
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
