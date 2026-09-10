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
import { AlertTriangle } from "lucide-react";
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

import { Loading } from "@/components/ui/primitives";
import type { BoxScoreTeam, GameDetail } from "@/lib/domain/gameday";

export function GameDrillIn({ eventId }: { eventId: string }) {
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
    <div>
      {/*
        The scoreline stays in the body rather than the dialog title: the title
        is rendered before the fetch resolves, and a header that pops a score
        in a beat later reads as a glitch.
      */}
      {detail && (
        <div
          className="sc-mono"
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          <span>
            {detail.away.abbr}{" "}
            <span style={{ color: "var(--sc-text-muted)" }}>{detail.away.score ?? "—"}</span>
          </span>
          <span style={{ color: "var(--sc-text-muted)", fontSize: 12 }}>at</span>
          <span>
            {detail.home.abbr}{" "}
            <span style={{ color: "var(--sc-text-muted)" }}>{detail.home.score ?? "—"}</span>
          </span>
        </div>
      )}

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
                  {/*
                    One chip per league, coloured by what the play was actually
                    worth there rather than by whose roster the player is on.
                    Those are different answers: an interception is negative for
                    the quarterback, so it is a *gain* in the league where you
                    are facing him — which is what the old "your player = plus"
                    chip got backwards.
                  */}
                  <div className="sc-play-impacts">
                    {play.impact.map((league) => (
                      <span
                        key={league.leagueId}
                        className="sc-play-impact"
                        data-effect={effectOf(league.net)}
                      >
                        {league.net != null && (
                          <span className="sc-mono">{signed(league.net)}</span>
                        )}{" "}
                        {league.leagueName}
                      </span>
                    ))}
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

          <BoxScore teams={detail.boxScore} />

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

/**
 * Which way a play went for you, or "unknown" when we cannot say.
 *
 * Zero is its own answer and a real one — an incompletion by your quarterback
 * genuinely cost you nothing — and is deliberately not lumped in with the
 * plays whose worth could not be derived.
 */
function effectOf(net: number | null): "help" | "hurt" | "none" | "unknown" {
  if (net == null) return "unknown";
  if (net > 0) return "help";
  if (net < 0) return "hurt";
  return "none";
}

/** A point swing, always carrying its sign so the direction is unmissable. */
function signed(net: number): string {
  const rounded = Math.round(net * 10) / 10;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)}`;
}

/**
 * ESPN's own category keys, made readable.
 *
 * They arrive as camelCase identifiers — `kickReturns`, `puntReturns` — and
 * the heading style uppercases whatever it is given, so left alone they render
 * as KICKRETURNS.
 */
function prettyCategory(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Every category either team recorded, in the order they should be shown.
 *
 * Taken from the teams themselves rather than a fixed list, so a category ESPN
 * adds still appears. The important case is the asymmetric one: a category
 * only one team recorded — interceptions, punt returns — still has to occupy a
 * row in both columns, or the two sides stop describing the same category and
 * every heading below it is beside the wrong numbers.
 */
export function pairedCategoryNames(teams: BoxScoreTeam[]): string[] {
  const names: string[] = [];
  for (const team of teams) {
    for (const category of team.categories) {
      if (!names.includes(category.name)) names.push(category.name);
    }
  }
  return names;
}

/**
 * Both teams' box scores, side by side and paired by category.
 *
 * Previously this was one team's ten categories in full followed by the
 * other's, which put roughly a thousand pixels between a quarterback and the
 * quarterback he was playing against — the two lines you most want to read
 * together. Pairing them puts passing beside passing and rushing beside
 * rushing, so a comparison is a glance rather than a scroll.
 *
 * Each column lists a player's numbers as one dot-separated line under their
 * name, rather than as a row of table cells, and that is the compromise that
 * makes two columns possible at all. A passing category carries eight
 * statistics; two of those as real tables need ~700px, and this dialog is
 * ~340px wide on a phone. The legend above each column names the values once
 * in the order they appear, which keeps them unambiguous without spending the
 * width on repeated headers. One rendering serves every screen size, so there
 * is no width at which the layout is untested.
 */
function BoxScore({ teams }: { teams: BoxScoreTeam[] }) {
  const names = pairedCategoryNames(teams);

  if (names.length === 0) return null;

  return (
    <>
      {names.map((name) => (
        <Section key={name} title={prettyCategory(name)}>
          <div className="sc-box-pair">
            {teams.map((team) => {
              const category = team.categories.find((c) => c.name === name);
              return (
                <div key={team.abbr} className="sc-box-col">
                  <div className="sc-box-team">{team.abbr}</div>
                  {!category ? (
                    <div className="sc-box-legend">nothing recorded</div>
                  ) : (
                    <>
                      <div className="sc-box-legend sc-mono">
                        {category.labels.join(" · ")}
                      </div>
                      {category.players.map((player, i) => (
                        <div
                          key={`${player.playerId ?? player.name}-${i}`}
                          className="sc-box-row"
                          data-side={
                            player.mine ? "mine" : player.against ? "against" : undefined
                          }
                        >
                          <div className="sc-box-name sc-truncate" title={player.name}>
                            {player.name}
                          </div>
                          <div className="sc-box-stats sc-mono">
                            {category.labels
                              .map((_, j) => player.stats[j] ?? "—")
                              .join(" · ")}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      ))}
    </>
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
