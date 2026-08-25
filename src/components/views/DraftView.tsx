"use client";

/**
 * Draft Recap — real picks from Sleeper's draft endpoints, filterable by round
 * and by the team that made the pick.
 */
import { useMemo, useState } from "react";
import { Trophy } from "lucide-react";

import type { DashboardData } from "@/lib/domain/types";
import { EmptyState, PosTag } from "@/components/ui/primitives";

export function DraftView({ data }: { data: DashboardData }) {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [round, setRound] = useState<string>("ALL");
  const [drafter, setDrafter] = useState<string>("ALL");

  const draft = data.drafts.find((d) => d.leagueId === leagueId) ?? data.drafts[0];

  const rounds = useMemo(
    () => [...new Set(draft?.picks.map((p) => p.round) ?? [])].sort((a, b) => a - b),
    [draft],
  );
  const drafters = useMemo(
    () => [...new Set(draft?.picks.map((p) => p.pickedBy) ?? [])].sort(),
    [draft],
  );

  const picks = useMemo(
    () =>
      (draft?.picks ?? []).filter((p) => {
        if (round !== "ALL" && p.round !== Number(round)) return false;
        if (drafter !== "ALL" && p.pickedBy !== drafter) return false;
        return true;
      }),
    [draft, round, drafter],
  );

  if (data.drafts.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="No draft data yet"
        body="None of your leagues have completed a draft this season. Recaps appear here once picks are in."
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <select
          className="sc-select"
          value={draft?.leagueId ?? ""}
          onChange={(e) => {
            setLeagueId(e.target.value);
            setRound("ALL");
            setDrafter("ALL");
          }}
          aria-label="Choose a league"
        >
          {data.drafts.map((d) => (
            <option key={d.leagueId} value={d.leagueId}>
              {d.leagueName} ({d.season})
            </option>
          ))}
        </select>

        <select
          className="sc-select"
          value={round}
          onChange={(e) => setRound(e.target.value)}
          aria-label="Filter by round"
        >
          <option value="ALL">All rounds</option>
          {rounds.map((r) => (
            <option key={r} value={r}>
              Round {r}
            </option>
          ))}
        </select>

        <select
          className="sc-select"
          value={drafter}
          onChange={(e) => setDrafter(e.target.value)}
          aria-label="Filter by team"
        >
          <option value="ALL">All teams</option>
          {drafters.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div style={{ fontSize: 12, color: "var(--sc-text-muted)", marginBottom: 8 }}>
        {picks.length} pick{picks.length === 1 ? "" : "s"}
        {draft?.rounds ? ` · ${draft.rounds} rounds` : ""}
        {draft?.status ? ` · ${draft.status.replace(/_/g, " ")}` : ""}
      </div>

      <div className="sc-table-scroll">
        <table className="sc-table">
          <thead>
            <tr>
              <th>Pick</th>
              <th>Round</th>
              <th>Player</th>
              <th>Pos</th>
              <th>NFL team</th>
              <th>Drafted by</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => (
              <tr key={p.pickNo}>
                <td className="sc-mono">{p.pickNo}</td>
                <td className="sc-mono" style={{ color: "var(--sc-text-muted)" }}>
                  {p.round}
                  {p.draftSlot != null && (
                    <span style={{ fontSize: 11 }}>.{p.draftSlot}</span>
                  )}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {p.playerName}
                  {p.isKeeper && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--sc-accent)",
                      }}
                    >
                      KEEPER
                    </span>
                  )}
                </td>
                <td>
                  <PosTag pos={p.position} />
                </td>
                <td style={{ color: "var(--sc-text-muted)" }}>{p.nflTeam || "—"}</td>
                <td>{p.pickedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
