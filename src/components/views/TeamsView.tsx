"use client";

/**
 * Teams — drill into any of your teams: record, this week's matchup, position
 * grades against the real league, and the roster split into starters, bench,
 * IR and taxi squad.
 */
import { useMemo } from "react";
import { Users } from "lucide-react";

import {
  computeTeamGrades,
  defaultTeam,
  type TeamGrades,
} from "@/lib/domain/analytics";
import {
  GRADE_COLOR,
  GRADE_POSITIONS,
  sortByPosition,
} from "@/lib/domain/positions";
import type { DashboardData, MyTeam, RosterPlayer } from "@/lib/domain/types";
import {
  ConsistencyTag,
  EmptyState,
  PlatformBadge,
  PlayerName,
  FormatBadge,
  PosTag,
  StatusTag,
  fmt,
  fmtFaab,
} from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/Avatar";

export function TeamsView({
  data,
  selectedTeamId,
  onSelect,
}: {
  data: DashboardData;
  selectedTeamId: string | null;
  onSelect: (id: string) => void;
}) {
  const teams = data.teams;
  const team = teams.find((t) => t.id === selectedTeamId) ?? defaultTeam(teams);

  if (!team) {
    return (
      <EmptyState
        icon={Users}
        title="No teams"
        body="Nothing to show yet — no leagues were loaded for this season."
      />
    );
  }

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
      <aside style={{ width: 210, flexShrink: 0, position: "sticky", top: 0 }}>
        <div className="sc-section-title">Your teams</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className="sc-nav-btn"
              style={{
                background: t.id === team.id ? "var(--sc-surface-raised)" : "transparent",
                color: t.id === team.id ? "var(--sc-text)" : "var(--sc-text-muted)",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 2,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>
                <Avatar src={t.avatar} name={t.teamName} size={24} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="sc-truncate" style={{ display: "block" }}>
                    {t.teamName}
                  </span>
                  <span
                    className="sc-truncate"
                    style={{ fontSize: 11, fontWeight: 400, display: "block" }}
                  >
                    {t.leagueName}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        <TeamDetail team={team} viewedWeek={data.viewedWeek} />
      </div>
    </div>
  );
}

function TeamDetail({ team, viewedWeek }: { team: MyTeam; viewedWeek: number }) {
  const grades = useMemo(() => computeTeamGrades(team), [team]);
  const waiver = useMemo(() => waiverStat(team), [team]);

  const starters = sortByPosition(team.starters);
  const bench = sortByPosition(team.bench.filter((p) => p.kind === "bench"));
  const ir = sortByPosition(team.bench.filter((p) => p.kind === "ir"));
  const taxi = sortByPosition(team.bench.filter((p) => p.kind === "taxi"));

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Avatar src={team.avatar} name={team.teamName} size={44} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{team.teamName}</div>
            <div
              style={{
                fontSize: 12,
                color: "var(--sc-text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Avatar
                src={team.leagueAvatar}
                name={team.leagueName}
                size={16}
                rounded="square"
              />
              {team.leagueName} · {team.totalRosters}-team · {team.season}
            </div>
          </div>
        </div>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <FormatBadge format={team.leagueFormat} />
          <PlatformBadge platform={team.platform} />
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, margin: "14px 0", flexWrap: "wrap" }}>
        <StatCard label="Record" value={team.record} />
        <StatCard label="Points for" value={fmt(team.pointsFor)} />
        <StatCard label="Points against" value={fmt(team.pointsAgainst)} />
        <StatCard label={waiver.label} value={waiver.value} />
        {team.matchup ? (
          <StatCard
            label={`Week ${viewedWeek} vs ${team.matchup.opponent?.teamName ?? "—"}`}
            value={
              team.matchup.mine.score != null
                ? `${fmt(team.matchup.mine.score)}${
                    team.matchup.opponent ? ` – ${fmt(team.matchup.opponent.score)}` : ""
                  }`
                : "—"
            }
          />
        ) : (
          <StatCard label={`Week ${viewedWeek}`} value="No matchup" />
        )}
      </div>

      <div className="sc-section-title">Position grades vs. league</div>
      <GradeRow grades={grades} />

      <RosterSection title="Starters" rows={starters} showSlot />
      {bench.length > 0 && <RosterSection title="Bench" rows={bench} />}
      {ir.length > 0 && <RosterSection title="Injured reserve" rows={ir} />}
      {taxi.length > 0 && <RosterSection title="Taxi squad" rows={taxi} />}
    </div>
  );
}

/**
 * Waivers as one stat card. Which number is meaningful depends on the league:
 * a FAAB league has a budget and no priority, a rolling-waiver league has a
 * priority and no budget, and showing the wrong one is worse than showing
 * neither. The budget rides in the label so the value stays a single figure
 * that cannot overflow the card.
 */
function waiverStat(team: MyTeam): { label: string; value: string } {
  const mine = team.leagueTeams.find((t) => t.isMine);

  if (team.waiverMode === "priority") {
    return {
      label: "Waiver priority",
      value: mine?.waiverPosition != null ? `#${mine.waiverPosition}` : "—",
    };
  }

  return {
    label:
      team.faabBudget != null ? `FAAB left of ${fmtFaab(team.faabBudget)}` : "FAAB left",
    value: fmtFaab(mine?.faabRemaining),
  };
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="sc-card" style={{ padding: 12, flex: "1 1 150px", minWidth: 0 }}>
      <div className="sc-truncate" style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
        {label}
      </div>
      <div className="sc-mono" style={{ fontSize: 18, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

function GradeRow({ grades }: { grades: TeamGrades }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
      {GRADE_POSITIONS.map((pos) => {
        const g = grades[pos];
        const color = GRADE_COLOR[g.letter];
        return (
          <div
            key={pos}
            className="sc-card"
            style={{
              padding: "8px 14px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flex: "1 1 110px",
            }}
            title={`${g.value} value vs a league average of ${g.leagueAverage}`}
          >
            <div
              style={{ fontSize: 11, color: "var(--sc-text-muted)", fontWeight: 700 }}
            >
              {pos}
            </div>
            <div
              className="sc-mono"
              style={{ marginLeft: "auto", fontWeight: 700, fontSize: 18, color }}
            >
              {g.letter}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RosterSection({
  title,
  rows,
  showSlot = false,
}: {
  title: string;
  rows: RosterPlayer[];
  showSlot?: boolean;
}) {
  return (
    <>
      <div className="sc-section-title" style={{ marginTop: 18 }}>
        {title}
      </div>
      <RosterTable rows={rows} showSlot={showSlot} />
    </>
  );
}

function RosterTable({
  rows,
  showSlot,
}: {
  rows: RosterPlayer[];
  showSlot?: boolean;
}) {
  if (rows.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>Empty.</div>;
  }

  const anyPoints = rows.some((r) => r.points != null);

  return (
    <div className="sc-table-scroll">
      <table className="sc-table">
        <thead>
          <tr>
            <th>{showSlot ? "Slot" : "Pos"}</th>
            <th>Player</th>
            <th>Team</th>
            <th>Bye</th>
            <th>Status</th>
            <th>Trend</th>
            {anyPoints && <th style={{ textAlign: "right" }}>Pts</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <PosTag pos={showSlot ? (r.slotPosition ?? r.position) : r.position} />
              </td>
              <td>
                <PlayerName name={r.name} nickname={r.nickname} />
                {showSlot && r.slotPosition !== r.position && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 11,
                      color: "var(--sc-text-muted)",
                    }}
                  >
                    {r.position}
                  </span>
                )}
              </td>
              <td style={{ color: "var(--sc-text-muted)" }}>{r.nflTeam || "—"}</td>
              <td className="sc-mono" style={{ color: "var(--sc-text-muted)" }}>
                {r.byeWeek ?? "—"}
              </td>
              <td>
                <StatusTag status={r.status} bodyPart={r.injuryBodyPart} withIcon />
              </td>
              <td>
                <ConsistencyTag consistency={r.consistency} samples={r.seasonSamples} />
              </td>
              {anyPoints && (
                <td className="sc-mono" style={{ textAlign: "right" }}>
                  {fmt(r.points)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
