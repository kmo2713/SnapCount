"use client";

/**
 * Your nine races, one card each.
 *
 * The card answers three questions in the order you actually ask them on a
 * Sunday: what is the score, how likely am I to win, and how much is still to
 * come. The last one is the reason a bare score is not enough — being down
 * twelve with your whole lineup yet to play is a completely different
 * afternoon from being down twelve with nobody left, and a scoreboard that
 * shows only the first number cannot tell you which one you are having.
 *
 * The rest of the league collapses underneath. It is folded away by default
 * because your own matchup is what you opened the app for, but it is one tap
 * away because in a Guillotine league everyone else's score IS your matchup.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { FormatBadge, PlatformBadge, fmt } from "@/components/ui/primitives";
import type { LiveMatchup, LiveMatchupSide } from "@/lib/domain/gameday";

function MatchupRailInner({ matchups }: { matchups: LiveMatchup[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {matchups.map((m) => (
        <LiveMatchupCard key={m.leagueId} matchup={m} />
      ))}
    </div>
  );
}

function LiveMatchupCard({ matchup: m }: { matchup: LiveMatchup }) {
  const [open, setOpen] = useState(false);

  const chance = m.winProbability ?? m.survival;
  const isSurvival = m.winProbability == null;

  // The margin, and which way it points. Null when there is no opponent to
  // have a margin against.
  const margin = m.opponent ? m.mine.score - m.opponent.score : null;
  const marginColor =
    margin == null
      ? "var(--sc-text-muted)"
      : margin > 0
        ? "var(--sc-green)"
        : margin < 0
          ? "var(--sc-red)"
          : "var(--sc-text-muted)";

  return (
    <div className="sc-card" style={{ padding: 10 }}>
      {/* -- league identity -- */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 12 }}
      >
        <Avatar src={m.leagueAvatar} name={m.leagueName} size={18} rounded="square" />
        <span className="sc-truncate" style={{ fontWeight: 600, minWidth: 0 }}>
          {m.leagueName}
        </span>
        <PlatformBadge platform={m.platform} compact />
        <FormatBadge format={m.leagueFormat} compact />
        <span
          className="sc-mono"
          style={{ marginLeft: "auto", fontSize: 11, color: "var(--sc-text-muted)" }}
          title="Live rank in this league"
        >
          #{m.liveRank}/{m.totalTeams}
        </span>
      </div>

      {/* -- the race -- */}
      <div className="sc-versus">
        <Side side={m.mine} mine />
        <div className="sc-versus-divider">
          <div style={{ textAlign: "center" }}>
            {margin != null ? (
              <div className="sc-mono" style={{ fontSize: 12, fontWeight: 700, color: marginColor }}>
                {margin > 0 ? "+" : ""}
                {fmt(margin)}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: "var(--sc-text-muted)" }}>vs</div>
            )}
          </div>
        </div>
        {m.opponent ? (
          <Side side={m.opponent} />
        ) : (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>the field</div>
            <div className="sc-mono" style={{ fontSize: 22, fontWeight: 700 }}>
              {m.totalTeams - 1}
            </div>
            <div style={{ fontSize: 10, color: "var(--sc-red)" }}>low score is eliminated</div>
          </div>
        )}
      </div>

      {/* -- the model's number, always labelled as a model -- */}
      {chance != null && (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              height: 4,
              borderRadius: 999,
              background: "var(--sc-accent-soft)",
              overflow: "hidden",
            }}
            role="img"
            aria-label={`${Math.round(chance * 100)} percent chance ${isSurvival ? "to survive" : "to win"}`}
          >
            <div
              style={{
                width: `${Math.round(chance * 100)}%`,
                height: "100%",
                background: "var(--sc-accent)",
              }}
            />
          </div>
          <div
            className="sc-mono"
            style={{ fontSize: 10, color: "var(--sc-text-muted)", marginTop: 3 }}
          >
            {Math.round(chance * 100)}% {isSurvival ? "to survive" : "to win"}
            <span style={{ fontFamily: "var(--sc-font-body)" }}> · projected</span>
          </div>
        </div>
      )}

      {/* -- the rest of the league -- */}
      <button
        type="button"
        className="sc-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          marginTop: 8,
          width: "100%",
          minHeight: 44,
          justifyContent: "flex-start",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "var(--sc-text-muted)",
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {open ? "Hide" : "Show"} all {m.totalTeams} teams
      </button>

      {open && (
        <div style={{ marginTop: 6 }}>
          <table className="sc-table" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ width: 26 }}>#</th>
                <th>Team</th>
                <th style={{ textAlign: "right" }}>Score</th>
                <th style={{ textAlign: "right" }}>Proj left</th>
                <th style={{ textAlign: "right" }}>To play</th>
              </tr>
            </thead>
            <tbody>
              {m.standings.map((row, i) => (
                <tr
                  key={row.teamId}
                  style={{
                    background: row.isMine ? "var(--sc-accent-soft)" : undefined,
                  }}
                >
                  <td className="sc-mono">{i + 1}</td>
                  <td
                    className="sc-truncate"
                    style={{ color: row.isMine ? "var(--sc-accent)" : undefined }}
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
                    {fmt(row.remaining, 0)}
                  </td>
                  <td className="sc-mono" style={{ textAlign: "right" }}>
                    {row.yetToPlay}
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

function Side({ side, mine = false }: { side: LiveMatchupSide; mine?: boolean }) {
  return (
    <div className={mine ? undefined : "sc-versus-side"} style={mine ? undefined : { textAlign: "right" }}>
      <div
        className="sc-truncate"
        style={{ fontSize: 11, color: mine ? "var(--sc-accent)" : "var(--sc-text)" }}
      >
        {side.teamName}
      </div>
      <div className="sc-mono" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15 }}>
        {fmt(side.score)}
      </div>
      {/*
        Projection and progress, kept visually quieter than the score. These
        are the numbers that say whether the score means anything yet, but they
        are estimates and must never read as loudly as the real one.
      */}
      <div style={{ fontSize: 10, color: "var(--sc-cyan)" }}>+{fmt(side.remaining, 0)} proj</div>
      <div style={{ fontSize: 10, color: "var(--sc-text-muted)" }}>
        {side.yetToPlay} to play
        {side.inProgress > 0 ? ` · ${side.inProgress} in game` : ""}
      </div>
    </div>
  );
}

/* Memoised for the same reason as the game wall: nine cards, poll-rate props. */
export const MatchupRail = memo(MatchupRailInner);
