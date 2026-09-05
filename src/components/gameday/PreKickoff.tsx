"use client";

/**
 * The 11:55 panel.
 *
 * Before the noon slate locks, the useful thing is not a score — there are no
 * scores — but a list of who is questionable, across all nine lineups at once.
 * Checking that league by league is precisely the chore this app exists to
 * remove, and it is the one moment in the week where a minute of attention
 * genuinely changes the outcome.
 *
 * Collapses to nothing once every alert is locked, because a warning you can
 * no longer act on is just noise.
 */
import { AlertTriangle, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { useState } from "react";

import { PosTag } from "@/components/ui/primitives";
import type { LineupAlert } from "@/lib/domain/gameday";

/** Colour by how bad the designation is. */
function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.startsWith("q")) return "var(--sc-orange)";
  if (s.startsWith("d")) return "var(--sc-red)";
  return "var(--sc-red)";
}

/**
 * How many alerts show before the rest fold away.
 *
 * Twelve questionable starters across nine leagues is an ordinary Sunday, and
 * rendering all twelve pushed every score below the fold — on a page whose
 * whole job is showing scores. The most urgent few are the ones you act on;
 * the rest are a list you scan once and close.
 */
const PREVIEW = 3;

export function PreKickoff({ alerts }: { alerts: LineupAlert[] }) {
  const [expanded, setExpanded] = useState(false);

  // Only the ones you can still do something about lead the panel.
  const actionable = alerts.filter((a) => a.gameState === "pre");
  const locked = alerts.filter((a) => a.gameState !== "pre");
  const shown = expanded ? actionable : actionable.slice(0, PREVIEW);

  /*
   * Gone entirely once nothing is actionable, which is what the header above
   * promises and what the code used to only half do: it kept rendering a
   * card, a "0 to check" counter and a note explaining there was nothing to
   * check. The list shrinks on its own through the afternoon as each player's
   * game kicks off and their alert moves from actionable to locked, so by the
   * second window this is usually empty — and an empty warning at the top of a
   * live scoreboard is just something in the way.
   *
   * The locked ones are not worth keeping either. Their value was telling you
   * what to decide before lock; afterwards they are history, and the score is
   * the thing you came back for.
   */
  if (actionable.length === 0) return null;

  return (
    <div
      className="sc-card"
      style={{ padding: 10, marginBottom: 10, borderColor: "var(--sc-orange)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <AlertTriangle size={14} color="var(--sc-orange)" />
        <span style={{ fontWeight: 600, fontSize: 12 }}>Before lineups lock</span>
        <span
          className="sc-mono"
          style={{ marginLeft: "auto", fontSize: 11, color: "var(--sc-text-muted)" }}
        >
          {actionable.length} to check
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {shown.map((alert) => (
          <AlertRow key={alert.playerId} alert={alert} />
        ))}

        {actionable.length > PREVIEW && (
          <button
            type="button"
            className="sc-btn"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            style={{
              minHeight: 44,
              justifyContent: "flex-start",
              fontSize: 11,
              color: "var(--sc-text-muted)",
            }}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {expanded ? "Show fewer" : `${actionable.length - PREVIEW} more to check`}
          </button>
        )}
      </div>

      {locked.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary
            style={{ fontSize: 11, color: "var(--sc-text-muted)", cursor: "pointer" }}
          >
            {locked.length} already locked
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {locked.map((alert) => (
              <AlertRow key={alert.playerId} alert={alert} locked />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function AlertRow({ alert, locked = false }: { alert: LineupAlert; locked?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        opacity: locked ? 0.55 : 1,
      }}
    >
      <PosTag pos={alert.position} />
      <span className="sc-truncate" style={{ fontWeight: 600, minWidth: 0 }}>
        {alert.name}
      </span>
      <span style={{ color: "var(--sc-text-muted)" }}>{alert.nflTeam}</span>
      <span style={{ color: statusColor(alert.status), fontWeight: 700 }}>
        {alert.status}
      </span>

      {/*
        The leagues are the point. The same questionable player is a different
        problem in each lineup he starts in, and this is the only place that
        sentence can be written.
      */}
      <span
        className="sc-truncate"
        style={{
          marginLeft: "auto",
          minWidth: 0,
          color: "var(--sc-text-muted)",
          textAlign: "right",
        }}
        title={alert.leagues.map((l) => l.leagueName).join(", ")}
      >
        starting in {alert.leagues.length}
        {alert.leagues.length === 1 ? " league" : " leagues"}
      </span>

      {alert.kickoff && !locked && (
        <span
          className="sc-mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            color: "var(--sc-text-muted)",
            flexShrink: 0,
          }}
        >
          <Clock size={10} />
          {new Date(alert.kickoff).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}
