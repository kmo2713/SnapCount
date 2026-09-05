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

  if (alerts.length === 0) return null;

  // Only the ones you can still do something about lead the panel.
  const actionable = alerts.filter((a) => a.gameState === "pre");
  const locked = alerts.filter((a) => a.gameState !== "pre");
  const shown = expanded ? actionable : actionable.slice(0, PREVIEW);

  return (
    <div
      className="sc-card"
      style={{
        padding: 10,
        marginBottom: 10,
        borderColor: actionable.length > 0 ? "var(--sc-orange)" : undefined,
      }}
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

      {actionable.length === 0 ? (
        <div className="sc-note" style={{ margin: 0 }}>
          Nothing left to decide — every flagged starter has kicked off.
        </div>
      ) : (
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
      )}

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
