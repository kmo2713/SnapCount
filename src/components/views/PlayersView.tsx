"use client";

/**
 * Players — searchable across everything you roster in every league.
 * Duplicates are meaningful here: rostering the same player in three leagues is
 * worth seeing, so rows are keyed by team + player rather than deduped.
 */
import { useMemo, useState } from "react";
import { ClipboardList, Search } from "lucide-react";

import { sortByPosition } from "@/lib/domain/positions";
import type { DashboardData, RosterPlayer } from "@/lib/domain/types";
import {
  ConsistencyTag,
  EmptyState,
  PlatformBadge,
  PlayerName,
  PosTag,
  StatusTag,
  fmt,
} from "@/components/ui/primitives";

interface Row extends RosterPlayer {
  rowId: string;
  teamName: string;
  leagueName: string;
  platform: DashboardData["teams"][number]["platform"];
}

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];
const SLOTS = ["ALL", "starter", "bench", "ir", "taxi"] as const;

export function PlayersView({ data }: { data: DashboardData }) {
  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [leagueFilter, setLeagueFilter] = useState("ALL");
  const [slotFilter, setSlotFilter] = useState<(typeof SLOTS)[number]>("ALL");

  const rows = useMemo<Row[]>(
    () =>
      data.teams.flatMap((t) =>
        t.roster.map((p) => ({
          ...p,
          rowId: `${t.id}:${p.id}`,
          teamName: t.teamName,
          leagueName: t.leagueName,
          platform: t.platform,
        })),
      ),
    [data.teams],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortByPosition(
      rows.filter((r) => {
        if (posFilter !== "ALL" && r.position !== posFilter) return false;
        if (leagueFilter !== "ALL" && r.leagueName !== leagueFilter) return false;
        if (slotFilter !== "ALL" && r.kind !== slotFilter) return false;
        if (q && !r.name.toLowerCase().includes(q)) return false;
        return true;
      }),
    );
  }, [rows, query, posFilter, leagueFilter, slotFilter]);

  const leagues = useMemo(
    () => [...new Set(data.teams.map((t) => t.leagueName))].sort(),
    [data.teams],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No players"
        body="No rosters were loaded. If your leagues are still pre-draft, rosters will fill in after the draft."
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: 11,
              color: "var(--sc-text-muted)",
            }}
          />
          <input
            className="sc-input"
            style={{ width: "100%", paddingLeft: 30 }}
            placeholder="Search your players…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search players"
          />
        </div>

        <select
          className="sc-select"
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value)}
          aria-label="Filter by position"
        >
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p === "ALL" ? "All positions" : p}
            </option>
          ))}
        </select>

        <select
          className="sc-select"
          value={slotFilter}
          onChange={(e) => setSlotFilter(e.target.value as (typeof SLOTS)[number])}
          aria-label="Filter by roster slot"
        >
          <option value="ALL">All slots</option>
          <option value="starter">Starters</option>
          <option value="bench">Bench</option>
          <option value="ir">Injured reserve</option>
          <option value="taxi">Taxi squad</option>
        </select>

        <select
          className="sc-select"
          value={leagueFilter}
          onChange={(e) => setLeagueFilter(e.target.value)}
          aria-label="Filter by league"
        >
          <option value="ALL">All leagues</option>
          {leagues.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div style={{ fontSize: 12, color: "var(--sc-text-muted)", marginBottom: 8 }}>
        {filtered.length} roster spot{filtered.length === 1 ? "" : "s"}
        {filtered.length !== rows.length && ` of ${rows.length}`}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matches"
          body="Nothing on your rosters matches those filters."
        />
      ) : (
        <div className="sc-table-scroll">
          <table className="sc-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Player</th>
                <th>NFL team</th>
                <th>Bye</th>
                <th>Slot</th>
                <th>Status</th>
                <th>Trend</th>
                <th style={{ textAlign: "right" }}>Avg</th>
                <th>Fantasy team</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.rowId}>
                  <td>
                    <PosTag pos={r.position} />
                  </td>
                  <td>
                    <PlayerName name={r.name} nickname={r.nickname} />
                  </td>
                  <td style={{ color: "var(--sc-text-muted)" }}>{r.nflTeam || "—"}</td>
                  <td className="sc-mono" style={{ color: "var(--sc-text-muted)" }}>
                    {r.byeWeek ?? "—"}
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
                        {r.slotPosition}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
                        {r.kind === "ir" ? "IR" : r.kind === "taxi" ? "Taxi" : "Bench"}
                      </span>
                    )}
                  </td>
                  <td>
                    <StatusTag status={r.status} bodyPart={r.injuryBodyPart} />
                  </td>
                  <td>
                    <ConsistencyTag
                      consistency={r.consistency}
                      samples={r.seasonSamples}
                    />
                  </td>
                  <td className="sc-mono" style={{ textAlign: "right" }}>
                    {fmt(r.seasonAvgPoints)}
                  </td>
                  <td>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <PlatformBadge platform={r.platform} />
                      <span
                        className="sc-truncate"
                        style={{
                          fontSize: 11,
                          color: "var(--sc-text-muted)",
                          maxWidth: 180,
                        }}
                      >
                        {r.teamName} · {r.leagueName}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
