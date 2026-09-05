"use client";

/**
 * One game, opened up.
 *
 * The box score is ESPN's; what makes it worth opening here is that your
 * starters and the ones playing against you are picked out of it across all
 * nine leagues at once. Every line resolves by athlete id rather than by name
 * — ESPN's site ids share the fantasy API's id space, so the crosswalk this
 * app already keeps does the work.
 *
 * Loaded on open, never with the poll. This payload is ~595KB for one game
 * against ~135KB for the whole slate.
 */
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Loading, Pill } from "@/components/ui/primitives";
import type { GameDetail } from "@/lib/domain/gameday";

export function GameDrillIn({
  eventId,
  onClose,
}: {
  eventId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Key plays by default. A rostered quarterback touches nearly every snap, so
   * the unfiltered feed is most of the game — useful to have, not useful to
   * open on.
   */
  const [allPlays, setAllPlays] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /*
     * Aborted rather than merely ignored. The cancelled flag stops the state
     * update, but a ~595KB body would keep downloading after the panel closed,
     * and flicking through cards on a phone stacks those up.
     */
    const controller = new AbortController();

    fetch(`/api/gameday/game/${eventId}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        // Parse defensively and only after checking status: a 500 that returns
        // an HTML error page would otherwise surface as "Unexpected token <".
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (cancelled) return;
        if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
        setDetail(body as GameDetail);
      })
      .catch((err: unknown) => {
        // An abort is this component doing its job, not a failure to report.
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [eventId]);

  /* Recomputed only when the payload or the toggle changes, not per render. */
  const keyPlays = useMemo(
    () => detail?.plays.filter((p) => p.consequential) ?? [],
    [detail],
  );
  const shownPlays = allPlays ? (detail?.plays ?? []) : keyPlays;

  return (
    <div className="sc-card" id="gameday-drill-in" style={{ padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>
          {detail ? detail.shortName : "Loading game"}
        </span>
        {detail && (
          <>
            <span className="sc-mono" style={{ fontSize: 12 }}>
              {detail.away.abbr} {detail.away.score ?? "—"} @ {detail.home.abbr}{" "}
              {detail.home.score ?? "—"}
            </span>
            <span style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
              {detail.statusDetail}
            </span>
            {detail.state === "in" && <Pill label="LIVE" color="var(--sc-red)" />}
          </>
        )}
        <button
          type="button"
          className="sc-btn"
          onClick={onClose}
          aria-label="Close game detail"
          style={{
            marginLeft: "auto",
            minHeight: 44,
            minWidth: 44,
            display: "grid",
            placeItems: "center",
          }}
        >
          <X size={14} />
        </button>
      </div>

      {error && (
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            color: "var(--sc-red)",
            fontSize: 12,
          }}
        >
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {!detail && !error && <Loading label="Loading box score" />}

      {detail && (
        <>
          {detail.warnings.map((w, i) => (
            <div key={i} className="sc-note" style={{ marginTop: 0 }}>
              {w}
            </div>
          ))}

          {detail.boxScore.every((t) => t.categories.length === 0) &&
            detail.scoringPlays.length === 0 &&
            detail.plays.length === 0 &&
            detail.drives.length === 0 && (
              <div className="sc-note">
                Nothing to show yet — this game has not started.
              </div>
            )}

          {detail.winProbability.length > 1 && (
            <WinProbabilityChart detail={detail} />
          )}

          {detail.plays.length > 0 && (
            <Section
              title={`Your plays`}
              action={
                <button
                  type="button"
                  className="sc-btn"
                  onClick={() => setAllPlays((v) => !v)}
                  aria-pressed={allPlays}
                  style={{ fontSize: 10, minHeight: 44, padding: "0 8px" }}
                >
                  {allPlays
                    ? `All ${detail.plays.length}`
                    : `Key ${keyPlays.length}`}
                </button>
              }
            >
              {/*
                Not a play-by-play — ESPN gives you that for free. This is only
                the plays involving someone you have a stake in, and the point
                of it is the annotation underneath: the same catch can help you
                in two leagues and hurt you in a third.
              */}
              {shownPlays.map((play) => (
                <div
                  key={play.id}
                  style={{
                    fontSize: 11,
                    padding: "4px 0 4px 6px",
                    borderLeft: play.scoringPlay
                      ? "2px solid var(--sc-green)"
                      : "2px solid var(--sc-border)",
                    marginBottom: 2,
                  }}
                >
                  <div style={{ display: "flex", gap: 6 }}>
                    <span
                      className="sc-mono"
                      style={{ color: "var(--sc-text-muted)", flexShrink: 0 }}
                    >
                      Q{play.period} {play.clock}
                    </span>
                    {play.team && <span style={{ fontWeight: 600 }}>{play.team}</span>}
                    <span>{play.text}</span>
                    {play.yards != null && play.yards !== 0 && (
                      <span
                        className="sc-mono"
                        style={{
                          marginLeft: "auto",
                          flexShrink: 0,
                          color: "var(--sc-text-muted)",
                        }}
                      >
                        {play.yards > 0 ? "+" : ""}
                        {play.yards}
                      </span>
                    )}
                  </div>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}
                  >
                    {play.involved.flatMap((person) =>
                      person.roles.map((role) => (
                        <span
                          key={`${person.playerId}-${role.leagueId}-${role.side}`}
                          style={{
                            fontSize: 9,
                            padding: "1px 5px",
                            borderRadius: 999,
                            color:
                              role.side === "mine"
                                ? "var(--sc-green)"
                                : "var(--sc-red)",
                            border: `1px solid ${
                              role.side === "mine"
                                ? "var(--sc-green)"
                                : "var(--sc-red)"
                            }55`,
                          }}
                        >
                          {role.side === "mine" ? "+" : "-"} {role.leagueName}
                        </span>
                      )),
                    )}
                  </div>
                </div>
              ))}
            </Section>
          )}

          {detail.scoringPlays.length > 0 && (
            <Section title="Scoring">
              {detail.scoringPlays.map((play) => (
                <div
                  key={play.id}
                  style={{
                    display: "flex",
                    gap: 8,
                    fontSize: 11,
                    padding: "3px 0",
                    borderLeft: play.involvesMine
                      ? "2px solid var(--sc-accent)"
                      : "2px solid transparent",
                    paddingLeft: 6,
                  }}
                >
                  <span
                    className="sc-mono"
                    style={{ color: "var(--sc-text-muted)", flexShrink: 0 }}
                  >
                    Q{play.period} {play.clock}
                  </span>
                  <span className="sc-truncate">{play.text}</span>
                  <span className="sc-mono" style={{ marginLeft: "auto", flexShrink: 0 }}>
                    {play.awayScore}-{play.homeScore}
                  </span>
                </div>
              ))}
            </Section>
          )}

          {detail.boxScore.map((team) => (
            <Section key={team.abbr} title={`${team.abbr} box score`}>
              {team.categories.map((category) => (
                <div key={category.name} style={{ marginBottom: 10 }}>
                  <div className="sc-label" style={{ marginBottom: 3 }}>
                    {category.name}
                  </div>
                  <div className="sc-table-scroll">
                    <table className="sc-table" style={{ fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th>Player</th>
                          {category.labels.map((label) => (
                            <th key={label} style={{ textAlign: "right" }}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {category.players.map((player, i) => (
                          <tr
                            key={`${player.playerId ?? player.name}-${i}`}
                            style={{
                              background: player.mine
                                ? "var(--sc-accent-soft)"
                                : undefined,
                            }}
                          >
                            <td
                              className="sc-truncate"
                              style={{
                                color: player.mine
                                  ? "var(--sc-accent)"
                                  : player.against
                                    ? "var(--sc-red)"
                                    : undefined,
                              }}
                            >
                              {player.name}
                            </td>
                            {category.labels.map((label, j) => (
                              <td
                                key={label}
                                className="sc-mono"
                                style={{ textAlign: "right" }}
                              >
                                {player.stats[j] ?? "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </Section>
          ))}

          {detail.drives.length > 0 && (
            <Section title={`Drives (${detail.drives.length})`}>
              {detail.drives.map((drive) => (
                <div
                  key={drive.id}
                  style={{ display: "flex", gap: 8, fontSize: 11, padding: "2px 0" }}
                >
                  <span style={{ width: 34, fontWeight: 600, flexShrink: 0 }}>
                    {drive.team}
                  </span>
                  <span
                    style={{
                      width: 84,
                      flexShrink: 0,
                      color: drive.isScore ? "var(--sc-green)" : "var(--sc-text-muted)",
                    }}
                  >
                    {drive.result}
                  </span>
                  <span className="sc-truncate" style={{ color: "var(--sc-text-muted)" }}>
                    {drive.description}
                  </span>
                </div>
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span className="sc-section-title">{title}</span>
        {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
      </div>
      {children}
    </div>
  );
}

function WinProbabilityChart({ detail }: { detail: GameDetail }) {
  /*
   * ESPN indexes these by play, not by clock — the entries carry a playId and
   * no timestamp — so the x-axis is play sequence. The axis is hidden rather
   * than labelled with meaningless numbers; the shape is the information.
   */
  const data = detail.winProbability.map((p) => ({
    index: p.index,
    home: Math.round(p.homeWinPercentage * 100),
  }));

  return (
    <div style={{ marginTop: 12 }}>
      <div className="sc-section-title" style={{ marginBottom: 6 }}>
        {detail.home.abbr} win probability
      </div>
      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <CartesianGrid stroke="var(--sc-border-soft)" vertical={false} />
            <XAxis dataKey="index" hide />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tick={{ fill: "var(--sc-text-muted)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "var(--sc-surface-raised)",
                border: "1px solid var(--sc-border)",
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={() => ""}
              formatter={(value) => [`${String(value)}%`, detail.home.abbr]}
            />
            <Line
              type="monotone"
              dataKey="home"
              stroke="var(--sc-accent)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
