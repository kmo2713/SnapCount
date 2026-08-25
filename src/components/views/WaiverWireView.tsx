"use client";

/**
 * Waiver Wire — Sleeper's real trending adds, plus gap-aware recommendations
 * matched against each team's weakest graded position.
 */
import { useMemo } from "react";
import { Flame, Newspaper, TrendingUp } from "lucide-react";

import { computeTeamGrades, weakestPosition } from "@/lib/domain/analytics";
import { GRADE_COLOR } from "@/lib/domain/positions";
import type { DashboardData } from "@/lib/domain/types";
import { EmptyState, PosTag } from "@/components/ui/primitives";

export function WaiverWireView({ data }: { data: DashboardData }) {
  const recommendations = useMemo(() => {
    const out: Array<{
      teamId: string;
      teamName: string;
      leagueName: string;
      pos: string;
      letter: string;
      candidateName: string;
      candidatePos: string;
      candidateTeam: string;
    }> = [];

    for (const team of data.teams) {
      const grades = computeTeamGrades(team);
      const weakest = weakestPosition(grades);
      if (weakest.grade.percentile > 0.45) continue;

      // Only suggest someone nobody in that league already holds.
      const heldInLeague = new Set(
        team.leagueTeams.flatMap((t) => t.roster.map((p) => p.id)),
      );
      const candidate = data.trending.find(
        (tr) => tr.position === weakest.pos && !heldInLeague.has(tr.playerId),
      );
      if (!candidate) continue;

      out.push({
        teamId: team.id,
        teamName: team.teamName,
        leagueName: team.leagueName,
        pos: weakest.pos,
        letter: weakest.grade.letter,
        candidateName: candidate.name,
        candidatePos: candidate.position,
        candidateTeam: candidate.nflTeam,
      });
    }
    return out;
  }, [data.teams, data.trending]);

  if (data.trending.length === 0) {
    return (
      <EmptyState
        icon={Newspaper}
        title="No trending data"
        body="Sleeper's trending-adds feed returned nothing. Run a sync, or try again shortly."
      />
    );
  }

  return (
    <div>
      {recommendations.length > 0 && (
        <>
          <div className="sc-section-title">Recommended for your gaps</div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginBottom: 22,
            }}
          >
            {recommendations.map((r, i) => (
              <div
                key={i}
                className="sc-card"
                style={{
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  borderColor: "var(--sc-accent-border)",
                  flexWrap: "wrap",
                }}
              >
                <Flame size={14} color="var(--sc-accent)" style={{ flexShrink: 0 }} />
                <PosTag pos={r.candidatePos} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {r.candidateName}
                </span>
                <span
                  style={{ fontSize: 12, color: "var(--sc-text-muted)", flex: 1 }}
                >
                  trending{r.candidateTeam ? `, ${r.candidateTeam}` : ""} · free in{" "}
                  {r.leagueName}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: GRADE_COLOR[r.letter] ?? "var(--sc-accent)",
                  }}
                >
                  {r.teamName} is {r.letter}-graded at {r.pos}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="sc-section-title">Trending adds, last 24 hours</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {data.trending.map((r) => (
          <div
            key={r.playerId}
            className="sc-card"
            style={{
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderColor: r.rostered ? "var(--sc-accent-border)" : "var(--sc-border)",
            }}
          >
            <TrendingUp size={15} color="var(--sc-green)" style={{ flexShrink: 0 }} />
            <PosTag pos={r.position} />
            <span className="sc-truncate" style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
              {r.name}
            </span>
            <span style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>
              {r.nflTeam || "—"}
            </span>
            <span
              className="sc-mono"
              style={{ fontSize: 11, color: "var(--sc-text-muted)", minWidth: 78, textAlign: "right" }}
            >
              {r.count.toLocaleString()} adds
            </span>
            {r.rostered && (
              <span
                style={{ fontSize: 10, fontWeight: 700, color: "var(--sc-accent)" }}
              >
                ON YOUR TEAM
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
