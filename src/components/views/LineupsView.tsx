"use client";

/**
 * Lineups — start/sit flags per team.
 *
 * The flags respect real lineup eligibility (a bench WR can fill a FLEX or
 * SUPER_FLEX slot but not a QB slot), real injury designations and real bye
 * weeks. The prototype compared same-position only, which silently missed every
 * flex swap in these leagues.
 */
import { useMemo } from "react";
import { AlertTriangle, CalendarOff, Flame, ListChecks } from "lucide-react";

import { lineupFlags, type LineupFlag } from "@/lib/domain/analytics";
import { sortByPosition } from "@/lib/domain/positions";
import type { DashboardData, MyTeam, RosterPlayer } from "@/lib/domain/types";
import {
  EmptyState,
  FormatBadge,
  PlatformBadge,
  PosTag,
  fmt,
} from "@/components/ui/primitives";
import { AnalysisPanel } from "@/components/ui/AnalysisPanel";

export function LineupsView({ data }: { data: DashboardData }) {
  if (data.teams.length === 0) {
    return <EmptyState icon={ListChecks} title="No teams" body="Nothing to show." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className="sc-note" style={{ marginBottom: 0 }}>
        Flags compare each starter against your best eligible bench option using
        Sleeper&apos;s own player ranking blended with season scoring, and always
        surface a starter who is ruled out or on bye. That is a cheap heuristic
        and it runs on every load; for a real read on a lineup, ask Claude on the
        card itself.
      </p>
      {data.teams.map((t) => (
        <LineupCard key={t.id} team={t} viewedWeek={data.viewedWeek} />
      ))}
    </div>
  );
}

function LineupCard({ team, viewedWeek }: { team: MyTeam; viewedWeek: number }) {
  const flags = useMemo(() => lineupFlags(team), [team]);
  const starters = sortByPosition(team.starters);
  const bench = sortByPosition(team.bench.filter((p) => p.kind === "bench"));

  if (starters.length === 0) {
    return (
      <div className="sc-card" style={{ padding: 14 }}>
        <CardHeader team={team} />
        <div style={{ fontSize: 12, color: "var(--sc-text-muted)", marginTop: 8 }}>
          No lineup set yet
          {team.leagueStatus === "pre_draft" ? " — this league hasn't drafted." : "."}
        </div>
      </div>
    );
  }

  return (
    <div className="sc-card" style={{ padding: 14 }}>
      <CardHeader team={team} />

      {flags.length > 0 && (
        <div
          style={{
            margin: "10px 0",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {flags.slice(0, 4).map((f, i) => (
            <FlagRow key={i} flag={f} />
          ))}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
          marginTop: 10,
        }}
      >
        <LineupColumn
          title={`Starting · week ${viewedWeek}`}
          rows={starters}
          showSlot
          viewedWeek={viewedWeek}
        />
        <LineupColumn title="Bench" rows={bench} muted viewedWeek={viewedWeek} />
      </div>

      <AnalysisPanel
        request={{ kind: "lineup", teamId: team.id }}
        label="Ask Claude about this lineup"
      />
    </div>
  );
}

function CardHeader({ team }: { team: MyTeam }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="sc-truncate" style={{ fontWeight: 700, fontSize: 14 }}>
          {team.teamName}
        </div>
        <div
          className="sc-truncate"
          style={{ fontSize: 11, color: "var(--sc-text-muted)" }}
        >
          {team.leagueName}
        </div>
      </div>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <FormatBadge format={team.leagueFormat} />
        <PlatformBadge platform={team.platform} />
      </span>
    </div>
  );
}

function FlagRow({ flag }: { flag: LineupFlag }) {
  const urgent =
    flag.starter.status === "Out" || flag.starter.status === "IR";
  const color = urgent ? "var(--sc-red)" : "var(--sc-accent)";
  const Icon = urgent ? AlertTriangle : Flame;

  return (
    <div
      style={{
        fontSize: 12,
        background: urgent ? "#D9534F1A" : "var(--sc-accent-soft)",
        border: `1px solid ${urgent ? "#D9534F44" : "var(--sc-accent-border)"}`,
        borderRadius: 8,
        padding: "6px 10px",
        color,
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        lineHeight: 1.45,
      }}
    >
      <Icon size={12} style={{ marginTop: 3, flexShrink: 0 }} />
      <span>
        Consider <b>{flag.replacement.name}</b> over{" "}
        <b>{flag.starter.name}</b> at {flag.starter.slotPosition} — {flag.reason}.
      </span>
    </div>
  );
}

function LineupColumn({
  title,
  rows,
  showSlot = false,
  muted = false,
  viewedWeek,
}: {
  title: string;
  rows: RosterPlayer[];
  showSlot?: boolean;
  muted?: boolean;
  viewedWeek: number;
}) {
  return (
    <div>
      <div className="sc-label" style={{ fontWeight: 700, marginBottom: 6 }}>
        {title}
      </div>
      {rows.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>Empty.</div>
      )}
      {rows.map((p) => {
        const onBye = p.byeWeek != null && p.byeWeek === viewedWeek;
        return (
          <div
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              padding: "5px 0",
              borderBottom: "1px solid var(--sc-border-soft)",
              color: muted ? "var(--sc-text-muted)" : undefined,
            }}
          >
            <span
              style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
            >
              <PosTag pos={showSlot ? (p.slotPosition ?? p.position) : p.position} />
              <span className="sc-truncate">{p.name}</span>
            </span>
            <span
              style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
            >
              {onBye && (
                <CalendarOff size={13} color="var(--sc-orange)" aria-label="On bye" />
              )}
              {p.status !== "Active" && (
                <AlertTriangle
                  size={13}
                  color="var(--sc-red)"
                  aria-label={p.status}
                />
              )}
              {p.points != null && (
                <span className="sc-mono" style={{ fontSize: 12 }}>
                  {fmt(p.points)}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
