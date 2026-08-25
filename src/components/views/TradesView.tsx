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

  const read = useMemo(() => {
    const out = myRoster.filter((p) => sending.includes(p.id));
    const inc = theirRoster.filter((p) => receiving.includes(p.id));
    if (out.length === 0 && inc.length === 0) return null;
    return evaluateTrade(
      out,
      inc,
      myTeam?.teamName ?? "You",
      opponent?.name ?? "Them",
    );
  }, [myRoster, theirRoster, sending, receiving, myTeam, opponent]);

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
        <div className="sc-card" style={{ padding: 14, marginTop: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            Trade value read
          </div>
          <div style={{ display: "flex", gap: 24, fontSize: 13, flexWrap: "wrap" }}>
            <div>
              {myTeam?.teamName} sends:{" "}
              <b className="sc-mono">{fmt(read.outgoing)}</b>
            </div>
            <div>
              {opponent?.name} sends:{" "}
              <b className="sc-mono">{fmt(read.incoming)}</b>
            </div>
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              color: read.balanced ? "var(--sc-green)" : "var(--sc-accent)",
            }}
          >
            {read.verdict}
          </div>
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
        className="sc-truncate"
        style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}
      >
        {title}
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
        {roster.map((p) => (
          <label
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 4px",
              fontSize: 13,
              cursor: "pointer",
              borderBottom: "1px solid var(--sc-border-soft)",
            }}
          >
            <input
              type="checkbox"
              checked={picked.includes(p.id)}
              onChange={() => onToggle(p.id)}
            />
            <PosTag pos={p.position} />
            <span className="sc-truncate" style={{ flex: 1 }}>
              {p.name}
            </span>
            <span
              className="sc-mono"
              style={{ fontSize: 11, color: "var(--sc-text-muted)" }}
            >
              {fmt(playerValue(p))}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export type { LeagueTeam };
