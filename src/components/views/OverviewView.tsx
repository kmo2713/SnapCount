"use client";

/**
 * Overview — every team across every platform, plus the "This week" briefing.
 *
 * The briefing is the prototype's idea kept intact, but each bullet now comes
 * from a real signal: real injury designations, real lineup eligibility, real
 * bye weeks, and gap suggestions computed against the actual rosters in your
 * league rather than generated opponents.
 */
import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarOff,
  Flame,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";

import {
  computeTeamGrades,
  lineupFlags,
  weakestPosition,
} from "@/lib/domain/analytics";
import type { DashboardData, MyTeam } from "@/lib/domain/types";
import {
  EmptyState,
  MetricCard,
  PlatformBadge,
  fmt,
} from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/Avatar";

interface BriefingItem {
  icon: React.ComponentType<{ size?: number; color?: string; style?: object }>;
  color: string;
  text: string;
}

function buildBriefing(data: DashboardData): BriefingItem[] {
  const items: BriefingItem[] = [];
  const { teams, viewedWeek } = data;

  /* -- injured starters -- */
  const injured = teams.flatMap((t) =>
    t.starters
      .filter((p) => p.status !== "Active")
      .map((p) => ({ team: t, player: p })),
  );
  if (injured.length > 0) {
    const preview = injured
      .slice(0, 2)
      .map((x) => `${x.player.name} (${x.player.status})`)
      .join(", ");
    items.push({
      icon: AlertTriangle,
      color: "var(--sc-red)",
      text: `${injured.length} starter${injured.length > 1 ? "s are" : " is"} banged up: ${preview}${
        injured.length > 2 ? `, +${injured.length - 2} more` : ""
      }.`,
    });
  }

  /* -- starters on bye this week -- */
  const onBye = teams.flatMap((t) =>
    t.starters
      .filter((p) => p.byeWeek != null && p.byeWeek === viewedWeek)
      .map((p) => ({ team: t, player: p })),
  );
  if (onBye.length > 0) {
    items.push({
      icon: CalendarOff,
      color: "var(--sc-orange)",
      text: `${onBye.length} starter${onBye.length > 1 ? "s are" : " is"} on bye in week ${viewedWeek}: ${onBye
        .slice(0, 3)
        .map((x) => x.player.name)
        .join(", ")}.`,
    });
  }

  /* -- start/sit upgrades -- */
  const swaps = teams.reduce((sum, t) => sum + lineupFlags(t).length, 0);
  if (swaps > 0) {
    items.push({
      icon: Flame,
      color: "var(--sc-accent)",
      text: `${swaps} possible start/sit upgrade${swaps > 1 ? "s" : ""} waiting in Lineups.`,
    });
  }

  /* -- closest matchup -- */
  const scored = teams.filter(
    (t) => t.matchup?.mine.score != null && t.matchup?.opponent?.score != null,
  );
  const closest = scored.sort((a, b) => margin(a) - margin(b))[0];
  if (closest && margin(closest) > 0) {
    items.push({
      icon: Activity,
      color: "var(--sc-cyan)",
      text: `${closest.teamName} has the closest matchup this week — within ${fmt(
        margin(closest),
      )} points.`,
    });
  }

  /* -- gap-aware waiver suggestion -- */
  for (const team of teams) {
    if (items.length >= 5) break;
    const grades = computeTeamGrades(team);
    const weakest = weakestPosition(grades);
    if (weakest.grade.percentile > 0.45) continue;

    const candidate = data.trending.find(
      (tr) => tr.position === weakest.pos && !tr.rostered,
    );
    if (!candidate) continue;

    items.push({
      icon: TrendingUp,
      color: "var(--sc-green)",
      text: `${candidate.name} is trending and could help ${team.teamName}'s ${weakest.pos} spot (graded ${weakest.grade.letter}).`,
    });
  }

  return items.slice(0, 5);
}

function margin(t: MyTeam): number {
  const mine = t.matchup?.mine.score ?? 0;
  const opp = t.matchup?.opponent?.score ?? 0;
  return Math.abs(mine - opp);
}

function BriefingCard({ data }: { data: DashboardData }) {
  const items = useMemo(() => buildBriefing(data), [data]);
  if (items.length === 0) return null;

  return (
    <div
      className="sc-card"
      style={{ padding: 14, marginBottom: 20, borderColor: "var(--sc-accent-border)" }}
    >
      <div
        className="sc-label"
        style={{ color: "var(--sc-accent)", marginBottom: 10, fontWeight: 700 }}
      >
        This week
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            <it.icon size={14} color={it.color} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{it.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverviewView({
  data,
  onSelect,
  onOpenMatchup,
}: {
  data: DashboardData;
  onSelect: (id: string) => void;
  onOpenMatchup: (id: string) => void;
}) {
  const { teams } = data;

  if (teams.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No teams found"
        body="Snap Count could not find any Sleeper leagues for this account in the current season. Check SLEEPER_USERNAME in your environment."
      />
    );
  }

  const best = [...teams].sort(
    (a, b) => b.wins - b.losses - (a.wins - a.losses),
  )[0];
  const scored = teams.filter(
    (t) => t.matchup?.mine.score != null && t.matchup?.opponent?.score != null,
  );
  const closest = [...scored].sort((a, b) => margin(a) - margin(b))[0];

  const started = teams.some((t) => t.wins + t.losses + t.ties > 0);

  return (
    <div>
      <BriefingCard data={data} />

      <div className="sc-grid-metrics">
        <MetricCard label="Total teams" value={teams.length} />
        <MetricCard
          label="Best record"
          value={started ? `${best.wins}-${best.losses}` : "—"}
          sub={started ? best.teamName : "season hasn't started"}
        />
        <MetricCard
          label="Closest matchup"
          value={closest && margin(closest) > 0 ? `${fmt(margin(closest))} pts` : "—"}
          sub={closest && margin(closest) > 0 ? closest.teamName : "no scores yet"}
        />
        <MetricCard
          label="Leagues"
          value={new Set(teams.map((t) => t.leagueId)).size}
          sub={`${new Set(teams.map((t) => t.platform)).size} platform${
            new Set(teams.map((t) => t.platform)).size > 1 ? "s" : ""
          }`}
        />
      </div>

      <div className="sc-section-title">All teams</div>
      <div className="sc-grid-teams">
        {teams.map((t) => (
          <TeamCard
            key={t.id}
            team={t}
            onSelect={onSelect}
            onOpenMatchup={onOpenMatchup}
          />
        ))}
      </div>
    </div>
  );
}

function TeamCard({
  team,
  onSelect,
  onOpenMatchup,
}: {
  team: MyTeam;
  onSelect: (id: string) => void;
  onOpenMatchup: (id: string) => void;
}) {
  const preDraft = team.leagueStatus === "pre_draft" || team.leagueStatus === "drafting";

  return (
    <div
      className="sc-card sc-hover"
      onClick={() => onSelect(team.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(team.id);
        }
      }}
      style={{ padding: 14 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 10,
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <Avatar src={team.avatar} name={team.teamName} size={34} />
          <div style={{ minWidth: 0 }}>
            <div className="sc-truncate" style={{ fontWeight: 700, fontSize: 14 }}>
              {team.teamName}
            </div>
            <div
              className="sc-truncate"
              style={{
                fontSize: 11,
                color: "var(--sc-text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Avatar
                src={team.leagueAvatar}
                name={team.leagueName}
                size={14}
                rounded="square"
              />
              <span className="sc-truncate">{team.leagueName}</span>
            </div>
          </div>
        </div>
        <PlatformBadge platform={team.platform} />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 8,
        }}
      >
        <div>
          <div className="sc-mono" style={{ fontSize: 16, fontWeight: 600 }}>
            {team.record}
          </div>
          <div style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
            {fmt(team.pointsFor)} PF · {team.totalRosters}-team
          </div>
        </div>

        {preDraft ? (
          <div style={{ fontSize: 11, color: "var(--sc-accent)", fontWeight: 600 }}>
            Draft pending
          </div>
        ) : team.matchup ? (
          // Nested inside the card, so stop the click from also opening the team.
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenMatchup(team.id);
            }}
            title="View this matchup"
            style={{
              textAlign: "right",
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "inherit",
              font: "inherit",
            }}
          >
            <div
              className="sc-truncate"
              style={{ fontSize: 11, color: "var(--sc-text-muted)", maxWidth: 120 }}
            >
              vs {team.matchup.opponent?.teamName ?? "—"}
            </div>
            <div className="sc-mono" style={{ fontSize: 14 }}>
              {fmt(team.matchup.mine.score)}
              {team.matchup.opponent && (
                <span style={{ color: "var(--sc-text-muted)" }}>
                  {" – "}
                  {fmt(team.matchup.opponent.score)}
                </span>
              )}
            </div>
            {team.matchup.mine.projected != null && (
              <div style={{ fontSize: 11, color: "var(--sc-cyan)" }}>
                proj <span className="sc-mono">{fmt(team.matchup.mine.projected)}</span>
                {team.matchup.opponent?.projected != null && (
                  <span style={{ color: "var(--sc-text-muted)" }}>
                    {" – "}
                    {fmt(team.matchup.opponent.projected)}
                  </span>
                )}
              </div>
            )}
          </button>
        ) : (
          <div style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
            no matchup yet
          </div>
        )}
      </div>
    </div>
  );
}

export { Trophy };
