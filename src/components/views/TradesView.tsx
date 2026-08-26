"use client";

/**
 * Trades — build a hypothetical with a real opponent in one of your leagues.
 *
 * Opponent rosters are genuine now, so the player list on the right is exactly
 * what that manager actually holds. The value read is still a heuristic; the
 * brief puts Claude-generated trade analysis in a later phase, and the copy
 * says so rather than implying more rigour than exists.
 */
import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";

import { defaultTeam, evaluateTrade, playerValue } from "@/lib/domain/analytics";
import { sortByPosition } from "@/lib/domain/positions";
import type { LeagueTeam, RosterPlayer } from "@/lib/domain/types";
import type { DashboardData } from "@/lib/domain/types";
import { EmptyState, PosTag, fmt } from "@/components/ui/primitives";
import { AnalysisPanel } from "@/components/ui/AnalysisPanel";

export function TradesView({ data }: { data: DashboardData }) {
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [oppId, setOppId] = useState<string | null>(null);
  const [sending, setSending] = useState<string[]>([]);
  const [receiving, setReceiving] = useState<string[]>([]);

  const myTeam = data.teams.find((t) => t.id === myTeamId) ?? defaultTeam(data.teams);

  const opponents = useMemo(
    () => (myTeam?.leagueTeams ?? []).filter((t) => !t.isMine),
    [myTeam],
  );
  const opponent = opponents.find((o) => o.id === oppId) ?? opponents[0];

  const myRoster = useMemo(
    () => sortByPosition(myTeam?.roster ?? []),
    [myTeam],
  );
  const theirRoster = useMemo(
    () => sortByPosition(opponent?.roster ?? []),
    [opponent],
  );

  const outgoingPlayers = useMemo(
    () => myRoster.filter((p) => sending.includes(p.id)),
    [myRoster, sending],
  );
  const incomingPlayers = useMemo(
    () => theirRoster.filter((p) => receiving.includes(p.id)),
    [theirRoster, receiving],
  );

  const read = useMemo(() => {
    const out = outgoingPlayers;
    const inc = incomingPlayers;
    if (out.length === 0 && inc.length === 0) return null;
    return evaluateTrade(
      out,
      inc,
      myTeam?.teamName ?? "You",
      opponent?.name ?? "Them",
    );
  }, [outgoingPlayers, incomingPlayers, myTeam, opponent]);

  if (data.teams.length === 0) {
    return (
      <EmptyState icon={ArrowLeftRight} title="No teams yet" body="Nothing to show." />
    );
  }

  const reset = () => {
    setSending([]);
    setReceiving([]);
  };

  return (
    <div>
      <p className="sc-note">
        Pick one of your teams, then another team in that same league. Values
        blend Sleeper&apos;s own player ranking with season scoring and injury
        status — a useful sanity check, not a rankings service. Snap Count is
        read-only: proposing the trade still happens in Sleeper.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <select
          className="sc-select"
          value={myTeam?.id ?? ""}
          onChange={(e) => {
            setMyTeamId(e.target.value);
            setOppId(null);
            reset();
          }}
          aria-label="Your team"
        >
          {data.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.teamName} — {t.leagueName}
            </option>
          ))}
        </select>

        <select
          className="sc-select"
          value={opponent?.id ?? ""}
          onChange={(e) => {
            setOppId(e.target.value);
            setReceiving([]);
          }}
          aria-label="Trade partner"
          disabled={opponents.length === 0}
        >
          {opponents.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.ownerName ? ` (${o.ownerName})` : ""}
            </option>
          ))}
        </select>

        {(sending.length > 0 || receiving.length > 0) && (
          <button className="sc-btn" onClick={reset}>
            Clear
          </button>
        )}
      </div>

      {opponents.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No other teams found"
          body="This league has no opponent roster data cached yet."
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 20,
          }}
        >
          <TradeSide
            title={`${myTeam?.teamName ?? "You"} sends`}
            roster={myRoster}
            picked={sending}
            onToggle={(id) =>
              setSending((s) =>
                s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
              )
            }
          />
          <TradeSide
            title={`${opponent?.name ?? "They"} sends`}
            roster={theirRoster}
            picked={receiving}
            onToggle={(id) =>
              setReceiving((s) =>
                s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
              )
            }
            emptyNote={
              theirRoster.length === 0
                ? "This roster is empty — the league may not have drafted yet."
                : undefined
            }
          />
        </div>
      )}

      {read && (
        <div className="sc-card" style={{ padding: 16, marginTop: 18 }}>
          <div className="sc-section-title">Proposed trade</div>

          {/* The trade itself, laid out as it would actually happen. */}
          <div className="sc-versus" style={{ gap: 14, alignItems: "stretch" }}>
            <TradeLeg
              heading={`${opponent?.name ?? "They"} receive`}
              players={outgoingPlayers}
              total={read.outgoing}
              align="left"
              emptyNote="Nothing selected from your roster"
            />

            <div
              className="sc-versus-divider"
              style={{ color: "var(--sc-text-muted)" }}
              aria-hidden="true"
            >
              <ArrowLeftRight size={20} />
            </div>

            <TradeLeg
              heading={`${myTeam?.teamName ?? "You"} receive`}
              players={incomingPlayers}
              total={read.incoming}
              align="right"
              highlight
              emptyNote={`Nothing selected from ${opponent?.name ?? "them"}`}
            />
          </div>

          {/* Net value, as a bar so the tilt is visible at a glance. */}
          <ValueBalance
            outgoing={read.outgoing}
            incoming={read.incoming}
            balanced={read.balanced}
            verdict={read.verdict}
          />

          <AnalysisPanel
            label="Ask Claude about this trade"
            request={
              myTeam && opponent
                ? {
                    kind: "trade",
                    teamId: myTeam.id,
                    opponentTeamId: opponent.id,
                    outgoingPlayerIds: sending,
                    incomingPlayerIds: receiving,
                  }
                : null
            }
          />
        </div>
      )}
    </div>
  );
}

function TradeSide({
  title,
  roster,
  picked,
  onToggle,
  emptyNote,
}: {
  title: string;
  roster: RosterPlayer[];
  picked: string[];
  onToggle: (id: string) => void;
  emptyNote?: string;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span className="sc-truncate" style={{ fontSize: 13, fontWeight: 700 }}>
          {title}
        </span>
        <span className="sc-label">
          {picked.length > 0 ? `${picked.length} selected` : "value"}
        </span>
      </div>
      <div
        className="sc-card"
        style={{ padding: 10, maxHeight: 380, overflowY: "auto" }}
      >
        {roster.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--sc-text-muted)", padding: 8 }}>
            {emptyNote ?? "No players."}
          </div>
        )}
        {roster.map((p) => {
          const selected = picked.includes(p.id);
          return (
            <label
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 6px",
                fontSize: 13,
                cursor: "pointer",
                borderBottom: "1px solid var(--sc-border-soft)",
                // Selected rows tint so the picker and the summary below agree
                // at a glance about who is in the deal.
                background: selected ? "var(--sc-accent-soft)" : "transparent",
                borderRadius: selected ? 6 : 0,
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggle(p.id)}
              />
              <PosTag pos={p.position} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  className="sc-truncate"
                  style={{ display: "block", fontWeight: selected ? 700 : 400 }}
                >
                  {p.name}
                </span>
                <span style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
                  {p.nflTeam || "—"}
                  {p.projectedPoints != null && ` · proj ${fmt(p.projectedPoints)}`}
                  {p.status !== "Active" && (
                    <span style={{ color: "var(--sc-red)" }}> · {p.status}</span>
                  )}
                </span>
              </span>
              <span
                className="sc-mono"
                title="Snap Count value"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: selected ? "var(--sc-accent)" : "var(--sc-text-muted)",
                  flexShrink: 0,
                }}
              >
                {fmt(playerValue(p))}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export type { LeagueTeam };

/**
 * One side of the proposed trade: who is moving, what each is worth, and the
 * side's total. Mirrored so the two legs read outward from the swap icon.
 */
function TradeLeg({
  heading,
  players,
  total,
  align,
  highlight = false,
  emptyNote,
}: {
  heading: string;
  players: RosterPlayer[];
  total: number;
  align: "left" | "right";
  /** The side you receive, tinted so the direction is obvious. */
  highlight?: boolean;
  emptyNote: string;
}) {
  const accent = highlight ? "var(--sc-green)" : "var(--sc-accent)";

  return (
    <div
      style={{
        background: "var(--sc-surface-raised)",
        border: `1px solid ${players.length > 0 ? `${accent}44` : "var(--sc-border)"}`,
        borderRadius: 8,
        padding: 12,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="sc-label"
        style={{ color: accent, textAlign: align, marginBottom: 8 }}
      >
        {heading}
      </div>

      {players.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--sc-text-muted)",
            textAlign: align,
            padding: "6px 0",
          }}
        >
          {emptyNote}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
          {players.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexDirection: align === "right" ? "row-reverse" : "row",
                minWidth: 0,
              }}
            >
              <PosTag pos={p.position} />
              <div style={{ minWidth: 0, flex: 1, textAlign: align }}>
                <div className="sc-truncate" style={{ fontSize: 13, fontWeight: 600 }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
                  {p.nflTeam || "—"}
                  {p.projectedPoints != null && ` · proj ${fmt(p.projectedPoints)}`}
                  {p.status !== "Active" && (
                    <span style={{ color: "var(--sc-red)" }}> · {p.status}</span>
                  )}
                </div>
              </div>
              <span
                className="sc-mono"
                title="Snap Count value — Sleeper rank blended with scoring and injury status"
                style={{ fontSize: 13, fontWeight: 700, color: accent, flexShrink: 0 }}
              >
                {fmt(playerValue(p))}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: "1px solid var(--sc-border)",
          display: "flex",
          justifyContent: align === "right" ? "flex-end" : "flex-start",
          alignItems: "baseline",
          gap: 6,
        }}
      >
        <span className="sc-label">total</span>
        <span className="sc-mono" style={{ fontSize: 16, fontWeight: 700, color: accent }}>
          {fmt(total)}
        </span>
      </div>
    </div>
  );
}

/**
 * A single bar showing how the value splits between the two sides, so the tilt
 * is legible without reading the numbers.
 */
function ValueBalance({
  outgoing,
  incoming,
  balanced,
  verdict,
}: {
  outgoing: number;
  incoming: number;
  balanced: boolean;
  verdict: string;
}) {
  const sum = outgoing + incoming;
  // With nothing on either side there is no ratio to draw; split it evenly.
  const outShare = sum > 0 ? (outgoing / sum) * 100 : 50;

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: "flex",
          height: 6,
          borderRadius: 3,
          overflow: "hidden",
          background: "var(--sc-border-soft)",
        }}
        role="img"
        aria-label={`Value split: ${fmt(outgoing)} out, ${fmt(incoming)} in`}
      >
        <div style={{ width: `${outShare}%`, background: "var(--sc-accent)" }} />
        <div style={{ width: `${100 - outShare}%`, background: "var(--sc-green)" }} />
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 13,
          color: balanced ? "var(--sc-green)" : "var(--sc-accent)",
        }}
      >
        {verdict}
      </div>
    </div>
  );
}
