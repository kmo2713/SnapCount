"use client";

/**
 * Waiver Wire — what you can afford to bid, Sleeper's real trending adds, and
 * gap-aware recommendations matched against each team's weakest graded
 * position.
 */
import { useMemo } from "react";
import { Flame, Newspaper, TrendingUp } from "lucide-react";

import { computeTeamGrades, weakestPosition } from "@/lib/domain/analytics";
import { GRADE_COLOR } from "@/lib/domain/positions";
import type { DashboardData, MyTeam } from "@/lib/domain/types";
import { EmptyState, PosTag, fmtFaab } from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/Avatar";

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

  return (
    <div>
      <WaiverBudgets teams={data.teams} />

      {data.trending.length === 0 && (
        <EmptyState
          icon={Newspaper}
          title="No trending data"
          body="Sleeper's trending-adds feed returned nothing. Run a sync, or try again shortly."
        />
      )}

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

      {data.trending.length > 0 && (
        <div className="sc-section-title">Trending adds, last 24 hours</div>
      )}
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

/**
 * What each of your teams still has to bid with. Shown first because it is the
 * constraint on everything below it — a trending add you cannot afford is not
 * a recommendation.
 */
function WaiverBudgets({ teams }: { teams: MyTeam[] }) {
  if (teams.length === 0) return null;

  return (
    <>
      <div className="sc-section-title">Waiver budgets</div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 22,
        }}
      >
        {teams.map((team) => (
          <BudgetCard key={team.id} team={team} />
        ))}
      </div>
    </>
  );
}

function BudgetCard({ team }: { team: MyTeam }) {
  const mine = team.leagueTeams.find((t) => t.isMine);
  const others = team.leagueTeams.filter((t) => !t.isMine);

  let value = "—";
  let caption = "not reported";
  let bar: number | null = null;
  let color = "var(--sc-text)";

  if (team.waiverMode === "priority") {
    // A rolling-waiver league has no budget at all, so showing $0 would read as
    // "you have spent everything" rather than "this league does not bid".
    value = mine?.waiverPosition != null ? `#${mine.waiverPosition}` : "—";
    caption =
      mine?.waiverPosition != null
        ? `waiver priority, ${ordinal(mine.waiverPosition)} of ${team.leagueTeams.length}`
        : "rolling waivers, no budget";
  } else if (team.faabBudget != null && mine?.faabRemaining != null) {
    const remaining = mine.faabRemaining;
    const share = team.faabBudget > 0 ? remaining / team.faabBudget : 0;
    value = fmtFaab(remaining);
    bar = share;
    color =
      share >= 0.5
        ? "var(--sc-green)"
        : share >= 0.2
          ? "var(--sc-accent)"
          : "var(--sc-red)";
    caption = `of ${fmtFaab(team.faabBudget)} · ${standing(remaining, others)}`;
  } else if (mine?.faabUsed != null) {
    // FAAB league whose budget the platform did not report — spend is still
    // real, the ceiling just is not known.
    value = fmtFaab(mine.faabUsed);
    caption = "spent, budget not reported";
  }

  return (
    <div className="sc-card" style={{ padding: 12, flex: "1 1 250px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Avatar
          src={team.leagueAvatar}
          name={team.leagueName}
          size={18}
          rounded="square"
        />
        <span
          className="sc-truncate"
          style={{ fontSize: 12, color: "var(--sc-text-muted)", flex: 1, minWidth: 0 }}
        >
          {team.leagueName}
        </span>
        <span className="sc-mono" style={{ fontSize: 17, fontWeight: 700, color }}>
          {value}
        </span>
      </div>

      {bar != null && (
        <div
          style={{
            height: 6,
            marginTop: 8,
            borderRadius: 999,
            background: "var(--sc-border)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.round(Math.min(1, Math.max(0, bar)) * 100)}%`,
              height: "100%",
              background: color,
              borderRadius: 999,
            }}
          />
        </div>
      )}

      <div
        className="sc-truncate"
        style={{ fontSize: 11, color: "var(--sc-text-muted)", marginTop: 6 }}
      >
        {caption}
      </div>
    </div>
  );
}

/**
 * Where your budget sits against the rest of the league. Before anyone has bid
 * every team is identical, and saying "1st of 12" there would be a flattering
 * lie — so a level field is called out as level.
 */
function standing(
  remaining: number,
  others: Array<{ faabRemaining: number | null }>,
): string {
  const known = others.filter((t) => t.faabRemaining != null);
  if (known.length === 0) return "no other rosters loaded";

  const ahead = known.filter((t) => t.faabRemaining! > remaining).length;
  const level = known.filter((t) => t.faabRemaining === remaining).length;

  if (level === known.length) return "the whole league is level";
  if (ahead === 0) return "nobody can outbid you";
  if (ahead === known.length) return "everyone can outbid you";
  return `${ahead} of ${known.length} can outbid you`;
}

function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
