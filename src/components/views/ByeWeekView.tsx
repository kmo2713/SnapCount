"use client";

/**
 * Bye Weeks — starters on bye per week per team, plus called-out collisions.
 *
 * Bye weeks are real, pulled from ESPN's public scoreboard feed at sync time.
 * When that data is missing the view says so instead of rendering a grid of
 * dashes that looks like "no byes".
 */
import { useMemo } from "react";
import { CalendarOff } from "lucide-react";

import { byeWeekList } from "@/lib/platforms/nfl/schedule";
import type { DashboardData, MyTeam, RosterPlayer } from "@/lib/domain/types";
import { EmptyState, PosTag } from "@/components/ui/primitives";

interface TeamByes {
  team: MyTeam;
  byWeek: Map<number, RosterPlayer[]>;
}

export function ByeWeekView({ data }: { data: DashboardData }) {
  const weeks = useMemo(() => byeWeekList(data.byeWeeks), [data.byeWeeks]);

  const table = useMemo<TeamByes[]>(
    () =>
      data.teams.map((team) => {
        const byWeek = new Map<number, RosterPlayer[]>();
        for (const w of weeks) byWeek.set(w, []);
        for (const p of team.starters) {
          if (p.byeWeek == null) continue;
          byWeek.get(p.byeWeek)?.push(p);
        }
        return { team, byWeek };
      }),
    [data.teams, weeks],
  );

  const collisions = useMemo(
    () =>
      table.flatMap(({ team, byWeek }) =>
        [...byWeek.entries()]
          .filter(([, players]) => players.length >= 2)
          .map(([week, players]) => ({ team, week, players })),
      ),
    [table],
  );

  if (data.teams.length === 0) {
    return <EmptyState icon={CalendarOff} title="No teams yet" body="Nothing to show." />;
  }

  if (weeks.length === 0) {
    return (
      <EmptyState
        icon={CalendarOff}
        title="Bye weeks not available"
        body={`No bye-week schedule has been loaded for ${data.state.season}. Run \`npm run sync:schedule\` to pull it from ESPN's public scoreboard feed — the NFL usually publishes it once the regular-season schedule is final.`}
      />
    );
  }

  return (
    <div>
      <p className="sc-note">
        Counts of your starters on bye each week. Two or more starters sharing a
        bye is a scramble week worth planning for early.
      </p>

      <div className="sc-table-scroll" style={{ marginBottom: 22 }}>
        <table className="sc-table" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Team</th>
              {weeks.map((w) => (
                <th key={w} style={{ textAlign: "center" }}>
                  W{w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.map(({ team, byWeek }) => (
              <tr key={team.id}>
                <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {team.teamName}
                </td>
                {weeks.map((w) => {
                  const n = byWeek.get(w)?.length ?? 0;
                  const color =
                    n >= 2
                      ? "var(--sc-red)"
                      : n === 1
                        ? "var(--sc-accent)"
                        : "var(--sc-text-muted)";
                  return (
                    <td
                      key={w}
                      className="sc-mono"
                      title={
                        n > 0
                          ? byWeek
                              .get(w)!
                              .map((p) => p.name)
                              .join(", ")
                          : undefined
                      }
                      style={{
                        textAlign: "center",
                        color,
                        fontWeight: n >= 2 ? 700 : 400,
                      }}
                    >
                      {n || "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sc-section-title">Bye collisions</div>
      {collisions.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--sc-text-muted)" }}>
          No team has two starters sharing a bye week.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {collisions
            .sort((a, b) => a.week - b.week)
            .map((c, i) => (
              <div
                key={i}
                className="sc-card"
                style={{ padding: "10px 12px", borderColor: "#D9534F44" }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  {c.team.teamName} — Week {c.week}
                  <span
                    style={{
                      marginLeft: 8,
                      fontWeight: 400,
                      fontSize: 11,
                      color: "var(--sc-text-muted)",
                    }}
                  >
                    {c.team.leagueName}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {c.players.map((p) => (
                    <span
                      key={p.id}
                      style={{
                        fontSize: 12,
                        color: "var(--sc-text-muted)",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <PosTag pos={p.slotPosition ?? p.position} />
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
