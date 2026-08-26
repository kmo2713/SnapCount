"use client";

/**
 * Matchups — your week's head-to-head, both lineups side by side.
 *
 * Two modes in one view: a list of every matchup you have this week, and the
 * detail for one of them. Clicking a matchup anywhere in the app lands here.
 *
 * The lineups align on lineup *slot*, not position, so row N is the same slot
 * on both sides — which is the only way a FLEX row makes sense when one manager
 * started a WR there and the other started an RB.
 */
import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarOff,
  Swords,
} from "lucide-react";

import {
  buildAllMatchups,
  buildMatchupDetail,
  liveMargin,
  projectedMargin,
} from "@/lib/domain/matchup";
import type {
  DashboardData,
  MatchupDetail,
  MatchupSlotRow,
  MatchupTeamView,
  RosterPlayer,
} from "@/lib/domain/types";
import {
  EmptyState,
  FormatBadge,
  PlatformBadge,
  PosTag,
  fmt,
} from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/Avatar";

export function MatchupView({
  data,
  selectedTeamId,
  onSelect,
  onBack,
}: {
  data: DashboardData;
  /** Which team's matchup to show. Null shows the list. */
  selectedTeamId: string | null;
  onSelect: (teamId: string) => void;
  onBack: () => void;
}) {
  const all = useMemo(() => buildAllMatchups(data.teams), [data.teams]);

  const selectedTeam = data.teams.find((t) => t.id === selectedTeamId);
  const detail = selectedTeam ? buildMatchupDetail(selectedTeam) : null;

  if (all.length === 0) {
    return (
      <EmptyState
        icon={Swords}
        title="No matchups this week"
        body={
          data.state.inSeason
            ? "None of your leagues have a matchup scheduled for this week."
            : "Matchups appear once the regular season starts. Leagues that haven't drafted won't have one at all."
        }
      />
    );
  }

  if (detail) {
    return <MatchupDetailView detail={detail} onBack={onBack} />;
  }

  return <MatchupList matchups={all} onSelect={onSelect} week={data.viewedWeek} />;
}

/* ------------------------------------------------------------------ list -- */

function MatchupList({
  matchups,
  onSelect,
  week,
}: {
  matchups: MatchupDetail[];
  onSelect: (teamId: string) => void;
  week: number;
}) {
  return (
    <div>
      <p className="sc-note">
        Every matchup you have in week {week}. Pick one to see both lineups side
        by side.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {matchups.map((m) => (
          <MatchupCard key={m.teamId} detail={m} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function MatchupCard({
  detail,
  onSelect,
}: {
  detail: MatchupDetail;
  onSelect: (teamId: string) => void;
}) {
  const margin = projectedMargin(detail);
  const live = liveMargin(detail);

  return (
    <div
      className="sc-card sc-hover"
      onClick={() => onSelect(detail.teamId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(detail.teamId);
        }
      }}
      style={{ padding: 14 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <span className="sc-label">{detail.leagueName}</span>
        <FormatBadge format={detail.leagueFormat} />
        <PlatformBadge platform={detail.platform} />
      </div>

      <div className="sc-versus" style={{ alignItems: "center", gap: 12 }}>
        <SideSummary team={detail.mine} align="left" mine />
        <div className="sc-versus-divider" style={{ textAlign: "center" }}>
          <div
            className="sc-label"
            style={{ fontSize: 10, color: "var(--sc-text-muted)" }}
          >
            vs
          </div>
        </div>
        {detail.opponent ? (
          <SideSummary team={detail.opponent} align="right" />
        ) : (
          <div style={{ textAlign: "right", fontSize: 12, color: "var(--sc-text-muted)" }}>
            Bye week — no opponent
          </div>
        )}
      </div>

      {(margin != null || live != null) && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid var(--sc-border-soft)",
            fontSize: 12,
            color: "var(--sc-text-muted)",
          }}
        >
          {live != null && live !== 0 && (
            <>
              {live > 0 ? "Leading" : "Trailing"} by{" "}
              <span className="sc-mono">{fmt(Math.abs(live))}</span>
              {margin != null && " · "}
            </>
          )}
          {margin != null && (
            <>
              Projected {margin >= 0 ? "to win" : "to lose"} by{" "}
              <span
                className="sc-mono"
                style={{
                  color: margin >= 0 ? "var(--sc-green)" : "var(--sc-red)",
                }}
              >
                {fmt(Math.abs(margin))}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SideSummary({
  team,
  align,
  mine = false,
}: {
  team: MatchupTeamView;
  align: "left" | "right";
  mine?: boolean;
}) {
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: align === "right" ? "flex-end" : "flex-start",
          minWidth: 0,
        }}
      >
        {align === "left" && <Avatar src={team.avatar} name={team.name} size={26} />}
        <span
          className="sc-truncate"
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: mine ? "var(--sc-accent)" : "var(--sc-text)",
          }}
        >
          {team.name}
        </span>
        {align === "right" && <Avatar src={team.avatar} name={team.name} size={26} />}
      </div>
      <div style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
        {team.record}
        {team.ownerName && ` · ${team.ownerName}`}
      </div>
      <div style={{ marginTop: 4, display: "flex", gap: 10, justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
        <Figure label="score" value={team.score} />
        <Figure label="proj" value={team.projected} accent />
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | null;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className="sc-mono"
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: accent ? "var(--sc-cyan)" : "var(--sc-text)",
        }}
      >
        {fmt(value)}
      </div>
      <div className="sc-label" style={{ fontSize: 9 }}>
        {label}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- detail -- */

function MatchupDetailView({
  detail,
  onBack,
}: {
  detail: MatchupDetail;
  onBack: () => void;
}) {
  const margin = projectedMargin(detail);

  return (
    <div>
      <button
        className="sc-btn"
        onClick={onBack}
        style={{ marginBottom: 14 }}
      >
        <ArrowLeft size={14} />
        All matchups
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
          Week {detail.week}
        </h2>
        <span style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>
          {detail.leagueName}
        </span>
        <FormatBadge format={detail.leagueFormat} />
        <PlatformBadge platform={detail.platform} />
      </div>

      {/* Scoreboard header */}
      <div
        className="sc-card sc-versus"
        style={{ padding: 16, marginBottom: 8, alignItems: "center", gap: 14 }}
      >
        <TeamHeader team={detail.mine} align="left" mine />
        <div
          className="sc-label sc-versus-divider"
          style={{ fontSize: 11, textAlign: "center" }}
        >
          vs
        </div>
        {detail.opponent ? (
          <TeamHeader team={detail.opponent} align="right" />
        ) : (
          <div style={{ textAlign: "right", color: "var(--sc-text-muted)", fontSize: 13 }}>
            Bye week
          </div>
        )}
      </div>

      {detail.hasProjections ? (
        margin != null && (
          <div
            style={{
              textAlign: "center",
              fontSize: 13,
              marginBottom: 16,
              color: margin >= 0 ? "var(--sc-green)" : "var(--sc-red)",
            }}
          >
            Projected {margin >= 0 ? "win" : "loss"} by{" "}
            <span className="sc-mono" style={{ fontWeight: 700 }}>
              {fmt(Math.abs(margin))}
            </span>
          </div>
        )
      ) : (
        <p className="sc-note" style={{ textAlign: "center", margin: "0 auto 16px" }}>
          No projections published for this week yet.
        </p>
      )}

      {/* Slot-by-slot lineups */}
      <div className="sc-table-scroll">
        <table className="sc-table" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "right" }}>Proj</th>
              <th style={{ textAlign: "right" }}>Pts</th>
              <th style={{ textAlign: "right" }}>{detail.mine.name}</th>
              <th style={{ textAlign: "center", width: 70 }}>Slot</th>
              <th>{detail.opponent?.name ?? "—"}</th>
              <th style={{ textAlign: "left" }}>Pts</th>
              <th style={{ textAlign: "left" }}>Proj</th>
            </tr>
          </thead>
          <tbody>
            {detail.slots.map((row) => (
              <SlotRow key={row.slotIndex} row={row} />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td
                className="sc-mono"
                style={{
                  textAlign: "right",
                  fontWeight: 700,
                  color: "var(--sc-cyan)",
                  borderTop: "1px solid var(--sc-border)",
                }}
              >
                {fmt(detail.mine.projected)}
              </td>
              <td
                className="sc-mono"
                style={{
                  textAlign: "right",
                  fontWeight: 700,
                  borderTop: "1px solid var(--sc-border)",
                }}
              >
                {fmt(detail.mine.score)}
              </td>
              <td
                style={{
                  textAlign: "right",
                  borderTop: "1px solid var(--sc-border)",
                }}
                className="sc-label"
              >
                total
              </td>
              <td style={{ borderTop: "1px solid var(--sc-border)" }} />
              <td
                style={{ borderTop: "1px solid var(--sc-border)" }}
                className="sc-label"
              >
                total
              </td>
              <td
                className="sc-mono"
                style={{ fontWeight: 700, borderTop: "1px solid var(--sc-border)" }}
              >
                {fmt(detail.opponent?.score ?? null)}
              </td>
              <td
                className="sc-mono"
                style={{
                  fontWeight: 700,
                  color: "var(--sc-cyan)",
                  borderTop: "1px solid var(--sc-border)",
                }}
              >
                {fmt(detail.opponent?.projected ?? null)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Benches, for context on who could still be swapped in */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20,
          marginTop: 26,
        }}
      >
        <BenchColumn title={`${detail.mine.name} bench`} rows={detail.mine.bench} />
        {detail.opponent && (
          <BenchColumn
            title={`${detail.opponent.name} bench`}
            rows={detail.opponent.bench}
          />
        )}
      </div>
    </div>
  );
}

function TeamHeader({
  team,
  align,
  mine = false,
}: {
  team: MatchupTeamView;
  align: "left" | "right";
  mine?: boolean;
}) {
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          justifyContent: align === "right" ? "flex-end" : "flex-start",
          minWidth: 0,
          marginBottom: 2,
        }}
      >
        {align === "left" && <Avatar src={team.avatar} name={team.name} size={40} />}
        <span
          className="sc-truncate"
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: mine ? "var(--sc-accent)" : "var(--sc-text)",
          }}
        >
          {team.name}
        </span>
        {align === "right" && <Avatar src={team.avatar} name={team.name} size={40} />}
      </div>
      <div style={{ fontSize: 11, color: "var(--sc-text-muted)", marginBottom: 8 }}>
        {team.record}
        {team.ownerName && ` · ${team.ownerName}`}
      </div>
      <div
        className="sc-mono"
        style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}
      >
        {fmt(team.score)}
      </div>
      <div style={{ fontSize: 11, color: "var(--sc-cyan)", marginTop: 3 }}>
        proj <span className="sc-mono">{fmt(team.projected)}</span>
      </div>
    </div>
  );
}

/** One lineup slot, both sides. */
function SlotRow({ row }: { row: MatchupSlotRow }) {
  const mineProj = row.mine?.projectedPoints ?? null;
  const oppProj = row.opponent?.projectedPoints ?? null;

  // Highlight whichever side is projected higher in this slot.
  const mineWins = mineProj != null && oppProj != null && mineProj > oppProj;
  const oppWins = mineProj != null && oppProj != null && oppProj > mineProj;

  return (
    <tr>
      <td
        className="sc-mono"
        style={{
          textAlign: "right",
          color: mineWins ? "var(--sc-green)" : "var(--sc-text-muted)",
          fontWeight: mineWins ? 700 : 400,
        }}
      >
        {fmt(mineProj)}
      </td>
      <td className="sc-mono" style={{ textAlign: "right" }}>
        {fmt(row.mine?.points ?? null)}
      </td>
      <td style={{ textAlign: "right" }}>
        <PlayerCell player={row.mine} align="right" />
      </td>
      <td style={{ textAlign: "center" }}>
        <PosTag pos={row.slot} />
      </td>
      <td>
        <PlayerCell player={row.opponent} align="left" />
      </td>
      <td className="sc-mono">{fmt(row.opponent?.points ?? null)}</td>
      <td
        className="sc-mono"
        style={{
          color: oppWins ? "var(--sc-green)" : "var(--sc-text-muted)",
          fontWeight: oppWins ? 700 : 400,
        }}
      >
        {fmt(oppProj)}
      </td>
    </tr>
  );
}

function PlayerCell({
  player,
  align,
}: {
  player: RosterPlayer | null;
  align: "left" | "right";
}) {
  if (!player) {
    return (
      <span style={{ color: "var(--sc-text-muted)", fontSize: 12 }}>Empty</span>
    );
  }

  const injured = player.status !== "Active";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        minWidth: 0,
      }}
    >
      {align === "left" && <PosTag pos={player.position} />}
      <span style={{ minWidth: 0 }}>
        <span className="sc-truncate" style={{ fontWeight: 600, display: "block" }}>
          {player.name}
        </span>
        <span style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
          {player.nflTeam || "—"}
          {player.byeWeek != null && ` · bye ${player.byeWeek}`}
        </span>
      </span>
      {injured && (
        <AlertTriangle
          size={13}
          color="var(--sc-red)"
          aria-label={player.status}
        />
      )}
      {align === "right" && <PosTag pos={player.position} />}
    </div>
  );
}

function BenchColumn({ title, rows }: { title: string; rows: RosterPlayer[] }) {
  const sorted = [...rows].sort(
    (a, b) => (b.projectedPoints ?? -1) - (a.projectedPoints ?? -1),
  );

  return (
    <div>
      <div className="sc-section-title">{title}</div>
      {sorted.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>Empty.</div>
      ) : (
        sorted.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              padding: "5px 0",
              borderBottom: "1px solid var(--sc-border-soft)",
              color: "var(--sc-text-muted)",
            }}
          >
            <PosTag pos={p.position} />
            <span className="sc-truncate" style={{ flex: 1 }}>
              {p.name}
            </span>
            {p.byeWeek != null && <CalendarOff size={12} />}
            {p.status !== "Active" && (
              <AlertTriangle size={12} color="var(--sc-red)" />
            )}
            <span className="sc-mono" style={{ color: "var(--sc-cyan)" }}>
              {fmt(p.projectedPoints)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
