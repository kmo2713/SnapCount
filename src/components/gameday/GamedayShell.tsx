"use client";

/**
 * The game-day screen.
 *
 * A composition root and nothing else: it owns the poll, the rooting mode, and
 * the derived lookups the three panels need, then hands each of them what they
 * render. The panels know nothing about polling.
 *
 * Full-bleed and outside the dashboard's shell on purpose. At noon on a Sunday
 * the header, the thirteen-item rail and the content padding are all competing
 * with the thing you actually opened the app for.
 */
import { RefreshCw, Swords } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DayTimeline } from "@/components/gameday/DayTimeline";
import { GameDrillIn } from "@/components/gameday/GameDrillIn";
import { GuillotineWatch } from "@/components/gameday/GuillotineWatch";
import { GameWall } from "@/components/gameday/GameWall";
import { MatchupRail } from "@/components/gameday/MatchupRail";
import { PreKickoff } from "@/components/gameday/PreKickoff";
import { RootingBar } from "@/components/gameday/RootingBar";
import { EmptyState, Pill } from "@/components/ui/primitives";
import type { GamedayData, RootingMode } from "@/lib/domain/gameday";
import { useGamedayPoll } from "@/hooks/useGamedayPoll";

export function GamedayShell({ initialData }: { initialData: GamedayData }) {
  const { data, generatedAt, refreshing, error, refresh } = useGamedayPoll(initialData);
  const [mode, setMode] = useState<RootingMode>("leverage");
  /** Which game is opened up. Null is the wall on its own. */
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  /* Stable identities, so the heavy panels below can be memoised. */
  const handleOpen = useCallback(
    (id: string) => setOpenEventId((current) => (current === id ? null : id)),
    [],
  );
  const handleClose = useCallback(() => setOpenEventId(null), []);
  const [showTimeline, setShowTimeline] = useState(false);

  const gameById = useMemo(
    () => new Map(data.games.map((g) => [g.eventId, g])),
    [data.games],
  );

  /*
   * Rebuilt as Maps once per payload rather than per card. They arrive as
   * plain records because a Map does not survive JSON.
   */
  const presence = useMemo(
    () => ({
      mine: new Map(Object.entries(data.presence.mine)),
      against: new Map(Object.entries(data.presence.against)),
    }),
    [data.presence],
  );

  /*
   * Survival leagues are pulled out of the rail. Guillotine is not a matchup
   * with a missing opponent — it is a different game, and showing it as a
   * head-to-head card with a blank right-hand side would misrepresent it.
   */
  const survival = useMemo(
    () => data.matchups.filter((m) => m.opponent === null),
    [data.matchups],
  );
  const headToHead = useMemo(
    () => data.matchups.filter((m) => m.opponent !== null),
    [data.matchups],
  );

  /*
   * A one-line read on the whole slate, for the wide empty band between the
   * wordmark and the controls. On a laptop that was nine hundred pixels of
   * nothing across the top of the page.
   */
  const summary = useMemo(() => {
    const live = data.games.filter((g) => g.state === "in").length;
    const starters = Object.values(data.presence.mine).reduce((n, v) => n + v, 0);
    const next = data.games
      .filter((g) => g.state === "pre")
      .map((g) => g.kickoff)
      .sort()[0];
    return { live, starters, leagues: data.matchups.length, next };
  }, [data]);

  const warnings = error ? [...data.warnings, error] : data.warnings;

  return (
    <div className="sc-gameday">
      <Header
        week={data.viewedWeek}
        summary={summary}
        generatedAt={generatedAt}
        anyLive={data.anyLive}
        refreshing={refreshing}
        onRefresh={refresh}
      />

      {warnings.length > 0 && (
        <div
          className="sc-card"
          style={{
            padding: "8px 10px",
            marginBottom: 10,
            borderColor: "var(--sc-red)",
            fontSize: 12,
            color: "var(--sc-text-muted)",
          }}
        >
          {warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <PreKickoff alerts={data.alerts} />

      <RootingBar
        rooting={data.rooting[mode]}
        games={gameById}
        mode={mode}
        onMode={setMode}
      />

      <div className="sc-gameday-grid">
        <section>
          <div className="sc-section-title" style={{ marginBottom: 8 }}>
            Your matchups
          </div>
          {data.matchups.length === 0 ? (
            <EmptyState
              icon={Swords}
              title="No live matchups"
              body="Nothing has drafted yet, or the cache is empty — run a sync."
            />
          ) : (
            <>
              <MatchupRail matchups={headToHead} />
              {survival.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  {survival.map((m) => (
                    <GuillotineWatch key={m.leagueId} matchup={m} />
                  ))}
                </div>
              )}
              <button
                type="button"
                className="sc-btn"
                onClick={() => setShowTimeline((v) => !v)}
                aria-expanded={showTimeline}
                style={{
                  marginTop: 8,
                  width: "100%",
                  minHeight: 44,
                  fontSize: 11,
                  color: "var(--sc-text-muted)",
                }}
              >
                {showTimeline ? "Hide" : "Show"} the day so far
              </button>
              {showTimeline && (
                <div style={{ marginTop: 8 }}>
                  <DayTimeline week={data.viewedWeek} />
                </div>
              )}
            </>
          )}
        </section>

        <section>
          <div className="sc-section-title" style={{ marginBottom: 8 }}>
            The slate
          </div>
          <GameWall
            games={data.games}
            presence={presence}
            onOpen={handleOpen}
            openEventId={openEventId}
          />
          {/*
            After the wall, not before it. A keyboard or screen-reader user
            activates a card and focus stays on that card — a panel rendered
            upstream of it is never reached by tabbing forward and is never
            announced.
          */}
          {openEventId && (
            <GameDrillIn
              key={openEventId}
              eventId={openEventId}
              onClose={handleClose}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function Header({
  week,
  summary,
  generatedAt,
  anyLive,
  refreshing,
  onRefresh,
}: {
  week: number;
  summary: { live: number; starters: number; leagues: number; next?: string };
  generatedAt: string;
  anyLive: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        marginBottom: 10,
      }}
    >
      <div
        style={{
          fontFamily: "var(--sc-font-display)",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "0.02em",
        }}
      >
        GAMEDAY
      </div>
      <span className="sc-mono" style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>
        Week {week}
      </span>
      {anyLive ? (
        <Pill label="LIVE" color="var(--sc-red)" />
      ) : (
        <Pill label="NO GAMES LIVE" color="var(--sc-text-muted)" />
      )}

      {/* The band that used to be empty. */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          fontSize: 11,
          color: "var(--sc-text-muted)",
          flexWrap: "wrap",
        }}
      >
        <span>
          <span className="sc-mono" style={{ color: "var(--sc-text)" }}>
            {summary.leagues}
          </span>{" "}
          leagues
        </span>
        <span>
          <span className="sc-mono" style={{ color: "var(--sc-text)" }}>
            {summary.starters}
          </span>{" "}
          starters
        </span>
        {summary.live > 0 ? (
          <span style={{ color: "var(--sc-red)" }}>
            <span className="sc-mono">{summary.live}</span> in progress
          </span>
        ) : (
          summary.next && (
            <span>
              next kickoff{" "}
              <span className="sc-mono" style={{ color: "var(--sc-text)" }}>
                {new Date(summary.next).toLocaleString(undefined, {
                  weekday: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </span>
          )
        )}
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <DataAge generatedAt={generatedAt} />
        <button
          type="button"
          className="sc-btn"
          onClick={onRefresh}
          aria-label="Refresh now"
          style={{ minHeight: 44, minWidth: 44, display: "grid", placeItems: "center" }}
        >
          <RefreshCw size={14} className={refreshing ? "spin" : undefined} />
        </button>
        <Link
          href="/"
          className="sc-btn"
          style={{
            fontSize: 11,
            minHeight: 44,
            display: "inline-flex",
            alignItems: "center",
            padding: "0 10px",
          }}
        >
          Dashboard
        </Link>
      </div>
    </header>
  );
}

/**
 * The only thing on this page that re-renders every second.
 *
 * Isolated deliberately: this counter used to live in the poll hook, where its
 * 1 Hz tick re-rendered the whole screen. Here it owns a single text node.
 * The interval pauses while the tab is hidden — nobody is reading a stale
 * counter they cannot see — and re-syncs the moment it comes back.
 */
function DataAge({ generatedAt }: { generatedAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    const id = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const built = Date.parse(generatedAt);
  const ageMs = Number.isFinite(built) ? Math.max(0, now - built) : 0;

  return (
    <span
      className="sc-mono"
      style={{ fontSize: 11, color: "var(--sc-text-muted)" }}
      // A live view that has quietly stopped updating is worse than one that
      // admits it, which is what this number is for.
      title="How old the displayed data is"
    >
      updated {Math.round(ageMs / 1000)}s ago
    </span>
  );
}
