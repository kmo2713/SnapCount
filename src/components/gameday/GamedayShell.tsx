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
import { LineChart as LineChartIcon, RefreshCw, Swords } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DayTimeline } from "@/components/gameday/DayTimeline";
import { GameDrillIn } from "@/components/gameday/GameDrillIn";
import { GuillotineWatch } from "@/components/gameday/GuillotineWatch";
import { GameWall } from "@/components/gameday/GameWall";
import { MatchupRail } from "@/components/gameday/MatchupRail";
import { PreKickoff } from "@/components/gameday/PreKickoff";
import { RootingBar } from "@/components/gameday/RootingBar";
import { Modal } from "@/components/ui/Modal";
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

  /*
   * The rooting strip costs ~130px of permanently sticky height, which on a
   * phone is a sixth of the screen. It is the best thing on the page for the
   * first look of the afternoon and dead weight for the next two hours, so it
   * folds away. Session state rather than a stored preference: the answer
   * genuinely differs between 12:05 and 15:30.
   */
  const [rootingOpen, setRootingOpen] = useState(true);
  const toggleRooting = useCallback(() => setRootingOpen((v) => !v), []);

  /*
   * Which half of the page a phone is showing. Ignored above 720px, where both
   * panes are on screen at once and the tab strip is display:none — so this
   * stays "matchups" forever on a laptop and costs nothing.
   */
  const [pane, setPane] = useState<"matchups" | "games">("matchups");

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

  /** The game the dialog is showing, for its title. */
  const openGame = openEventId ? gameById.get(openEventId) : undefined;

  const warnings = error ? [...data.warnings, error] : data.warnings;

  return (
    <div className="sc-gameday">
      <div className="sc-gameday-chrome">
        <Header
          week={data.viewedWeek}
          summary={summary}
          generatedAt={generatedAt}
          anyLive={data.anyLive}
          refreshing={refreshing}
          onRefresh={refresh}
        />

        <RootingBar
          rooting={data.rooting[mode]}
          games={gameById}
          mode={mode}
          onMode={setMode}
          open={rootingOpen}
          onToggle={toggleRooting}
        />

        {/*
          Phone-only, and inside the sticky band so switching halves never
          means scrolling back up to find the switch. Above 720px both panes
          are visible together and this is display:none.
        */}
        <div className="sc-gameday-tabs" role="tablist" aria-label="Game day sections">
          <button
            type="button"
            role="tab"
            aria-selected={pane === "matchups"}
            className="sc-gameday-tab"
            onClick={() => setPane("matchups")}
          >
            Matchups
            <span className="sc-mono sc-gameday-tab-count">{data.matchups.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pane === "games"}
            className="sc-gameday-tab"
            onClick={() => setPane("games")}
          >
            NFL games
            <span className="sc-mono sc-gameday-tab-count">{data.games.length}</span>
            {/* The reason you would switch tabs mid-afternoon. */}
            {summary.live > 0 && (
              <span className="sc-gameday-tab-live" aria-label={`${summary.live} live`} />
            )}
          </button>
        </div>
      </div>

      <div className="sc-gameday-body">

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

      <div className="sc-gameday-grid" data-pane={pane}>
        <section data-pane-id="matchups">
          {/*
            Redundant on a phone, where the selected tab already says which
            half you are looking at — so it is hidden there rather than
            spending a line of a small screen repeating the tab.
          */}
          <div className="sc-section-title sc-gameday-pane-title" style={{ marginBottom: 8 }}>
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
                onClick={() => setShowTimeline(true)}
                style={{
                  marginTop: 8,
                  width: "100%",
                  minHeight: 44,
                  fontSize: 11,
                  color: "var(--sc-text-muted)",
                }}
              >
                <LineChartIcon size={13} />
                The day so far
              </button>
            </>
          )}
        </section>

        <section data-pane-id="games">
          <div className="sc-section-title sc-gameday-pane-title" style={{ marginBottom: 8 }}>
            The slate
          </div>
          <GameWall
            games={data.games}
            presence={presence}
            onOpen={handleOpen}
            openEventId={openEventId}
          />
        </section>
      </div>
      </div>

      {/*
        Drill-in lives in a dialog rather than in the column that launched it.
        A box score inside the slate column was both too narrow to read and a
        thing that pushed the games you were looking at down the page; in the
        top layer it gets the room it needs and the overview stays an overview.
      */}
      <Modal
        open={openEventId !== null}
        onClose={handleClose}
        size="wide"
        title={openGame ? openGame.shortName : "Game"}
        subtitle={openGame?.statusDetail}
      >
        {openEventId && <GameDrillIn key={openEventId} eventId={openEventId} />}
      </Modal>

      <Modal
        open={showTimeline}
        onClose={() => setShowTimeline(false)}
        size="wide"
        title="The day so far"
        subtitle="Your score in each league, sampled through the afternoon"
      >
        {showTimeline && <DayTimeline week={data.viewedWeek} />}
      </Modal>
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
    <header className="sc-gameday-header">
      <div className="sc-gameday-wordmark">GAMEDAY</div>
      <span className="sc-mono" style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>
        Week {week}
      </span>
      {/*
        Dropped on a phone, where it was the single widest thing in the top row
        and the reason the controls wrapped onto a row of their own. Nothing is
        lost: the tab strip carries a live dot, and the line below reads
        "N in progress" in red when anything is, or the next kickoff when not.
      */}
      <span className="sc-gameday-live-pill">
        {anyLive ? (
          <Pill label="LIVE" color="var(--sc-red)" />
        ) : (
          <Pill label="NO GAMES LIVE" color="var(--sc-text-muted)" />
        )}
      </span>

      {/*
        The band that used to be empty on a laptop. On a phone there is no
        empty band to fill, so CSS reorders this onto its own line below —
        which is what stops the controls from landing on a third row.
      */}
      <div className="sc-gameday-title-meta">
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
        {/*
          Sits with the other facts about the slate rather than beside the
          refresh button. That keeps the controls row to two buttons, which is
          what lets the whole header be two lines on a phone instead of three.
        */}
        <DataAge generatedAt={generatedAt} />
      </div>

      <div className="sc-gameday-actions">
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
      /*
       * The one node on the page whose correct text differs between the server
       * and the client by design: the server renders the age at render time and
       * the client hydrates a moment later. When those land either side of a
       * second boundary React reports a text mismatch and throws away the whole
       * tree to re-render it — intermittently, roughly one load in ten, which
       * is exactly the kind of failure that never shows up while you are
       * looking for it. This is the sanctioned escape hatch for a timestamp.
       */
      suppressHydrationWarning
    >
      updated {Math.round(ageMs / 1000)}s ago
    </span>
  );
}
