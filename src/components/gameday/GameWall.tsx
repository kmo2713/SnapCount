"use client";

/**
 * Every game on the slate, grouped by kickoff window.
 *
 * Windows rather than a flat list because that is how a Sunday actually
 * arrives: eight games at noon, four more at 3:25, one at night. A flat list
 * sorted by time implies a continuum that does not exist and buries the fact
 * that the early window is where almost everything happens.
 *
 * Times render in the viewer's own zone. The windows are Central because that
 * is where these leagues are, but `toLocaleTimeString` decides what to print,
 * so this stays correct on a laptop that has travelled.
 */
import { memo, useMemo } from "react";

import { Pill } from "@/components/ui/primitives";
import type { NflGame } from "@/lib/domain/gameday";

/**
 * The red-zone radar's input, indexed for lookup.
 *
 * Named apart from the domain's `RosterPresence` deliberately: that one crosses
 * a JSON boundary and is therefore a `Record`, while this is the `Map` the
 * shell converts it into once per payload. Two same-named types with different
 * shapes is how one eventually gets passed where the other belongs.
 */
export interface PresenceIndex {
  /** NFL team abbreviation -> how many of the user's starters play for it. */
  mine: Map<string, number>;
  /** Same for the teams they are playing against this week. */
  against: Map<string, number>;
}

function GameWallInner({
  games,
  presence,
  onOpen,
  openEventId,
}: {
  games: NflGame[];
  presence: PresenceIndex;
  onOpen: (eventId: string) => void;
  openEventId: string | null;
}) {
  /*
   * Grouped by kickoff instant rather than by a hardcoded window list: the
   * schedule decides what the windows are, and a flex game or an international
   * kickoff would break any list we wrote down.
   */
  const windows = useMemo(() => {
    const byKickoff = new Map<string, NflGame[]>();
    for (const game of games) {
      const list = byKickoff.get(game.kickoff) ?? [];
      list.push(game);
      byKickoff.set(game.kickoff, list);
    }
    return [...byKickoff.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [games]);

  if (games.length === 0) {
    return <div className="sc-note">No games scheduled for this week.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {windows.map(([kickoff, windowGames]) => (
        <div key={kickoff}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span className="sc-label">{windowLabel(kickoff)}</span>
            <span style={{ fontSize: 10, color: "var(--sc-text-muted)" }}>
              {windowGames.length} {windowGames.length === 1 ? "game" : "games"}
            </span>
          </div>
          <div className="sc-gameday-games">
            {windowGames.map((game) => (
              <GameCard
                key={game.eventId}
                game={game}
                presence={presence}
                onOpen={onOpen}
                isOpen={openEventId === game.eventId}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** "Sun 12:00 PM" in the viewer's zone, or "TBD" if ESPN gave us nothing. */
function windowLabel(kickoff: string): string {
  const date = new Date(kickoff);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function GameCard({
  game,
  presence,
  onOpen,
  isOpen,
}: {
  game: NflGame;
  presence: PresenceIndex;
  onOpen: (eventId: string) => void;
  isOpen: boolean;
}) {
  const teams = [game.away.abbr, game.home.abbr].filter(Boolean);
  const mineHere = teams.reduce((n, t) => n + (presence.mine.get(t) ?? 0), 0);
  const againstHere = teams.reduce((n, t) => n + (presence.against.get(t) ?? 0), 0);

  /*
   * The radar only fires when the team in the red zone is one you have players
   * on. ESPN's flag alone would light up a third of the slate for games you
   * have no stake in, which is how an alert becomes noise.
   */
  const possession = game.situation?.possession ?? null;
  const redZoneForMe =
    game.situation?.isRedZone === true &&
    possession != null &&
    (presence.mine.get(possession) ?? 0) > 0;

  return (
    <div
      className={`sc-card sc-hover${redZoneForMe ? " sc-pulse" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      aria-controls={isOpen ? "gameday-drill-in" : undefined}
      onClick={() => onOpen(game.eventId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(game.eventId);
        }
      }}
      style={{
        padding: 10,
        fontSize: 12,
        // Only a red zone with your players in it earns the border, which is
        // what the comment above says the radar does. Colouring every red zone
        // lights up a third of the slate for games you have no stake in.
        borderColor: isOpen
          ? "var(--sc-accent)"
          : redZoneForMe
            ? "var(--sc-red)"
            : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span className="sc-mono" style={{ fontSize: 10, color: "var(--sc-text-muted)" }}>
          {game.statusDetail || "—"}
        </span>
        {game.state === "in" && <Pill label="LIVE" color="var(--sc-red)" />}
        {game.broadcast && (
          <span
            style={{ marginLeft: "auto", fontSize: 10, color: "var(--sc-text-muted)" }}
          >
            {game.broadcast}
          </span>
        )}
      </div>

      <TeamLine
        abbr={game.away.abbr}
        score={game.away.score}
        hasBall={possession === game.away.abbr && game.away.abbr !== ""}
        mine={(presence.mine.get(game.away.abbr) ?? 0) > 0}
      />
      <TeamLine
        abbr={game.home.abbr}
        score={game.home.score}
        hasBall={possession === game.home.abbr && game.home.abbr !== ""}
        mine={(presence.mine.get(game.home.abbr) ?? 0) > 0}
      />

      {game.situation && (
        <div style={{ marginTop: 6, fontSize: 10, color: "var(--sc-text-muted)" }}>
          <span className="sc-mono">
            Q{game.situation.period} {game.situation.clock}
          </span>
          {game.situation.downDistance ? ` · ${game.situation.downDistance}` : ""}
          {game.situation.isRedZone && (
            <span
              style={{
                color: "var(--sc-red)",
                fontWeight: 700,
                fontFamily: "var(--sc-font-body)",
              }}
            >
              {" "}
              · RED ZONE{redZoneForMe ? " — YOURS" : ""}
            </span>
          )}
        </div>
      )}

      {(mineHere > 0 || againstHere > 0) && (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            gap: 8,
            fontSize: 10,
            color: "var(--sc-text-muted)",
          }}
        >
          {mineHere > 0 && (
            <span style={{ color: "var(--sc-accent)" }}>
              {mineHere} yours
            </span>
          )}
          {againstHere > 0 && <span>{againstHere} against</span>}
        </div>
      )}

      {game.situation?.lastPlay && (
        <div
          className="sc-truncate"
          style={{ marginTop: 4, fontSize: 10, color: "var(--sc-text-muted)" }}
          title={game.situation.lastPlay}
        >
          {game.situation.lastPlay}
        </div>
      )}
    </div>
  );
}

function TeamLine({
  abbr,
  score,
  hasBall,
  mine,
}: {
  abbr: string;
  score: number | null;
  hasBall: boolean;
  mine: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        // role is required for the label to be announced at all: a bare
        // aria-label on a generic span is dropped by most screen readers.
        role={hasBall ? "img" : undefined}
        aria-label={hasBall ? "has possession" : undefined}
        style={{ width: 8, color: "var(--sc-accent)", fontSize: 10 }}
      >
        {hasBall ? "●" : ""}
      </span>
      <span style={{ fontWeight: 600, color: mine ? "var(--sc-accent)" : undefined }}>
        {abbr || "—"}
      </span>
      <span className="sc-mono" style={{ marginLeft: "auto", fontWeight: 700 }}>
        {score == null ? "—" : score}
      </span>
    </div>
  );
}

/*
 * Memoised: the wall reconciles sixteen cards, and its props (games, presence,
 * the open id, and a useCallback-stable onOpen) only change when a poll lands.
 */
export const GameWall = memo(GameWallInner);
