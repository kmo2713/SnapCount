"use client";

/**
 * Power Rankings — every team you own, ranked across leagues.
 *
 * Before kickoff, record and margin are zero for everyone, so the composite
 * falls back to roster strength rather than showing a meaningless dead heat.
 * Playoff odds are withheld entirely until games have been played, instead of
 * printing a fabricated percentage.
 */
import { useMemo } from "react";
import { Activity } from "lucide-react";

import {
  compositeScore,
  computeTeamGrades,
  playoffOdds,
  tierFor,
} from "@/lib/domain/analytics";
import { GRADE_COLOR, GRADE_POSITIONS } from "@/lib/domain/positions";
import type { DashboardData } from "@/lib/domain/types";
import { EmptyState, FormatBadge, PlatformBadge, Pill } from "@/components/ui/primitives";

export function PowerRankingsView({
  data,
  onSelect,
}: {
  data: DashboardData;
  onSelect: (id: string) => void;
}) {
  const ranked = useMemo(
    () =>
      data.teams
        .map((t) => ({
          team: t,
          score: compositeScore(t),
          odds: playoffOdds(t),
          grades: computeTeamGrades(t),
        }))
        .sort((a, b) => b.score - a.score),
    [data.teams],
  );

  if (ranked.length === 0) {
    return (
      <EmptyState icon={Activity} title="No teams yet" body="Nothing to rank." />
    );
  }

  const maxScore = Math.max(...ranked.map((r) => r.score), 1);
  const anyGamesPlayed = data.teams.some((t) => t.wins + t.losses + t.ties > 0);

  return (
    <div>
      <p className="sc-note">
        Ranked across all your teams by a blend of record, scoring margin and
        roster strength.{" "}
        {anyGamesPlayed
          ? "Playoff odds are a rough estimate from current record and point differential — not a season simulation."
          : "No games have been played yet, so this ranking reflects roster strength alone and playoff odds are withheld."}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ranked.map(({ team, score, odds, grades }, i) => {
          const tier = tierFor(i, ranked.length);
          return (
            <div
              key={team.id}
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
              style={{ padding: 14, display: "flex", alignItems: "center", gap: 14 }}
            >
              <div
                className="sc-mono"
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: "var(--sc-text-muted)",
                  width: 26,
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    className="sc-truncate"
                    style={{ fontWeight: 700, fontSize: 14, maxWidth: 220 }}
                  >
                    {team.teamName}
                  </span>
                  <FormatBadge format={team.leagueFormat} />
                  <PlatformBadge platform={team.platform} />
                  <Pill label={tier.label} color={tier.color} />
                  <span
                    className="sc-truncate"
                    style={{ fontSize: 11, color: "var(--sc-text-muted)", maxWidth: 200 }}
                  >
                    {team.leagueName}
                  </span>
                </div>

                <div
                  style={{
                    height: 5,
                    background: "var(--sc-border-soft)",
                    borderRadius: 3,
                    overflow: "hidden",
                    marginBottom: 6,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.max(4, (score / maxScore) * 100)}%`,
                      background: tier.color,
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {GRADE_POSITIONS.map((pos) => {
                    const g = grades[pos];
                    return (
                      <span
                        key={pos}
                        title={`${g.value} positional value vs a league average of ${g.leagueAverage}`}
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: GRADE_COLOR[g.letter],
                          border: `1px solid ${GRADE_COLOR[g.letter]}55`,
                          padding: "1px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {pos} {g.letter}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div className="sc-mono" style={{ fontSize: 16, fontWeight: 700 }}>
                  {team.record}
                </div>
                <div style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
                  {odds != null ? `${odds}% playoff odds` : "no games played"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
