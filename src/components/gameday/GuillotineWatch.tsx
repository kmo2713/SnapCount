"use client";

/**
 * The chopping block.
 *
 * Guillotine eliminates the week's lowest scorer, so the league has no
 * head-to-head at all — its matchup rows carry no opponent, which is why the
 * rest of the app has to branch on `opponent === null` rather than assume one.
 * Your opponent is the entire field, and the only question that matters is how
 * close you are to the bottom.
 *
 * That inverts everything the other cards show. A big score is nice; not being
 * last is the whole game. So this ranks from the bottom up, because the bottom
 * is where the danger is, and draws the line where the axe falls.
 */
import { Skull } from "lucide-react";
import { useMemo } from "react";

import { fmt } from "@/components/ui/primitives";
import type { LiveMatchup } from "@/lib/domain/gameday";

export function GuillotineWatch({ matchup }: { matchup: LiveMatchup }) {
  // Lowest first — the opposite of every other standings view in this app.
  const bottomUp = useMemo(
    () => [...matchup.standings].sort((a, b) => a.score - b.score),
    [matchup.standings],
  );
  const myIndex = bottomUp.findIndex((r) => r.isMine);
  const survival = matchup.survival;

  /*
   * How many places clear of last you are. Zero means you are currently the
   * one going out, which is the number this component exists to make
   * impossible to miss.
   */
  const cushion = myIndex;

  return (
    <div
      className="sc-card"
      style={{
        padding: 10,
        borderColor: cushion === 0 ? "var(--sc-red)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <Skull size={14} color="var(--sc-red)" />
        <span style={{ fontWeight: 600, fontSize: 12 }}>{matchup.leagueName}</span>
        <span
          className="sc-mono"
          style={{ marginLeft: "auto", fontSize: 11, color: "var(--sc-text-muted)" }}
        >
          {matchup.totalTeams} left
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          className="sc-mono"
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: cushion === 0 ? "var(--sc-red)" : "var(--sc-text)",
          }}
        >
          {cushion === 0 ? "LAST" : `+${cushion}`}
        </span>
        <span style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
          {cushion === 0
            ? "you are on the block"
            : `${cushion === 1 ? "place" : "places"} clear of the block`}
        </span>
        {survival != null && (
          <span
            className="sc-mono"
            style={{ marginLeft: "auto", fontSize: 11, color: "var(--sc-text-muted)" }}
          >
            {Math.round(survival * 100)}% safe
          </span>
        )}
      </div>

      <table className="sc-table" style={{ fontSize: 11 }}>
        <tbody>
          {bottomUp.map((row, i) => {
            const doomed = i === 0;
            return (
              <tr
                key={row.teamId}
                style={{
                  background: row.isMine ? "var(--sc-accent-soft)" : undefined,
                  // The axe falls between the bottom team and everyone else.
                  borderBottom: doomed ? "2px solid var(--sc-red)" : undefined,
                }}
              >
                <td className="sc-mono" style={{ width: 26 }}>
                  {matchup.totalTeams - i}
                </td>
                <td
                  className="sc-truncate"
                  style={{
                    color: row.isMine
                      ? "var(--sc-accent)"
                      : doomed
                        ? "var(--sc-red)"
                        : undefined,
                  }}
                >
                  {row.teamName}
                </td>
                <td className="sc-mono" style={{ textAlign: "right", fontWeight: 700 }}>
                  {fmt(row.score)}
                </td>
                <td
                  className="sc-mono"
                  style={{ textAlign: "right", color: "var(--sc-cyan)" }}
                >
                  +{fmt(row.remaining, 0)}
                </td>
                <td
                  className="sc-mono"
                  style={{ textAlign: "right", color: "var(--sc-text-muted)" }}
                >
                  {row.yetToPlay}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="sc-note" style={{ fontSize: 10 }}>
        Lowest score is eliminated. Ranked from the bottom, because that is the end
        that matters.
      </div>
    </div>
  );
}
