"use client";

/**
 * The app shell: fixed header with the cross-league scoreboard, fixed sidebar
 * nav, and a single scrolling content pane — the prototype's layout, now
 * driven by real data.
 */
import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  CalendarOff,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  HeartPulse,
  LayoutGrid,
  ListChecks,
  ListOrdered,
  Newspaper,
  Radio,
  RefreshCw,
  Swords,
  Trophy,
  Users,
} from "lucide-react";

import type { DashboardData } from "@/lib/domain/types";
import { FormatBadge, PlatformBadge, fmt } from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";

import { OverviewView } from "./views/OverviewView";
import { PowerRankingsView } from "./views/PowerRankingsView";
import { StandingsView } from "./views/StandingsView";
import { TeamsView } from "./views/TeamsView";
import { PlayersView } from "./views/PlayersView";
import { LineupsView } from "./views/LineupsView";
import { InjuryWatchView } from "./views/InjuryWatchView";
import { ByeWeekView } from "./views/ByeWeekView";
import { ChartsView } from "./views/ChartsView";
import { TradesView } from "./views/TradesView";
import { DraftView } from "./views/DraftView";
import { WaiverWireView } from "./views/WaiverWireView";
import { MatchupDetailModal, MatchupView } from "./views/MatchupView";

type TabId =
  | "overview"
  | "matchups"
  | "power"
  | "standings"
  | "teams"
  | "players"
  | "lineups"
  | "injuries"
  | "bye"
  | "charts"
  | "trades"
  | "draft"
  | "news";

const NAV: Array<{
  id: TabId;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "matchups", label: "Matchups", icon: Swords },
  { id: "power", label: "Power Rankings", icon: Activity },
  { id: "standings", label: "Standings", icon: ListOrdered },
  { id: "teams", label: "Teams", icon: Users },
  { id: "players", label: "Players", icon: ClipboardList },
  { id: "lineups", label: "Lineups", icon: ListChecks },
  { id: "injuries", label: "Injury Watch", icon: HeartPulse },
  { id: "bye", label: "Bye Weeks", icon: CalendarOff },
  { id: "charts", label: "Charts", icon: BarChart3 },
  { id: "trades", label: "Trades", icon: ArrowLeftRight },
  { id: "draft", label: "Draft Recap", icon: Trophy },
  { id: "news", label: "Waiver Wire", icon: Newspaper },
];

export function Dashboard({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<TabId>("overview");

  /* Phone-only drill-ins for the two things that used to scroll sideways. */
  const [showLeagues, setShowLeagues] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const activeNav = NAV.find((n) => n.id === tab) ?? NAV[0];

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  /** Which team’s head-to-head is open. Null shows the matchup list. */
  const [matchupTeamId, setMatchupTeamId] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setRefreshError(null);
    startRefresh(async () => {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
        setData((await res.json()) as DashboardData);
      } catch (err) {
        setRefreshError(err instanceof Error ? err.message : String(err));
      }
    });
  }, []);

  const totalRecord = useMemo(() => {
    let w = 0;
    let l = 0;
    let t = 0;
    for (const team of data.teams) {
      w += team.wins;
      l += team.losses;
      t += team.ties;
    }
    return { w, l, t };
  }, [data.teams]);

  const openTeam = useCallback((id: string) => {
    setSelectedTeamId(id);
    setTab("teams");
  }, []);

  /**
   * Open one team's head-to-head over whatever you are looking at.
   *
   * This used to switch you to the Matchups tab. From the scoreboard strip —
   * which is on every tab — that meant checking one score threw away the view
   * you were in and made getting back a two-step trip. The detail is a layer
   * now, so the tab you are on is the tab you stay on.
   */
  const openMatchup = useCallback((id: string) => {
    setMatchupTeamId(id);
  }, []);

  const warnings = refreshError ? [...data.warnings, refreshError] : data.warnings;

  return (
    <div className="sc-app">
      <header className="sc-header">
        <div className="sc-header-top">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="sc-wordmark">Snap Count</span>
            <span
              className="sc-tagline"
              style={{ fontSize: 12, color: "var(--sc-text-muted)" }}
            >
              all your fantasy teams, one screen
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/*
              The way into game day. Always present rather than only while a
              game is live, because the pre-kickoff state is deliberately worth
              opening — and a link that appears and disappears is a link nobody
              learns where to find.
            */}
            <Link
              href="/gameday"
              className="sc-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                minHeight: 34,
                padding: "0 10px",
                fontSize: 12,
                color: "var(--sc-accent)",
                borderColor: "var(--sc-accent-border)",
              }}
            >
              <Radio size={13} />
              Gameday
            </Link>

            <div style={{ textAlign: "right" }}>
              <div
                className="sc-mono"
                style={{ fontWeight: 600, fontSize: 18, color: "var(--sc-accent)" }}
              >
                {totalRecord.w}-{totalRecord.l}
                {totalRecord.t > 0 ? `-${totalRecord.t}` : ""}
              </div>
              <div className="sc-label" style={{ fontSize: 10 }}>
                combined record
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div className="sc-mono" style={{ fontWeight: 600, fontSize: 14 }}>
                {data.state.inSeason
                  ? `Week ${data.viewedWeek}`
                  : data.state.seasonType === "pre"
                    ? "Preseason"
                    : "Offseason"}
              </div>
              <div className="sc-label" style={{ fontSize: 10 }}>
                {data.state.season} · {data.source}
              </div>
            </div>

            <button
              className="sc-btn"
              onClick={refresh}
              disabled={refreshing}
              title="Reload from the cache / Sleeper"
            >
              <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            </button>
          </div>
        </div>

        {/*
          Cross-league scoreboard.

          A row of tiles on a laptop, where nine of them fit across. On a phone
          nine tiles is 1,328px of sideways scrolling in permanently-visible
          chrome, so it collapses to one button and the same tiles open
          stacked in a dialog — where they get the full width and read better
          than they ever did squeezed into 143px.
        */}
        <div className="sc-scoreboard-strip">
          {data.teams.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--sc-text-muted)", padding: "6px 0" }}>
              No teams loaded.
            </div>
          )}
          {data.teams.map((t) => (
            <ScoreboardTile
              key={t.id}
              team={t}
              onOpen={() => (t.matchup ? openMatchup(t.id) : openTeam(t.id))}
            />
          ))}
        </div>

        {data.teams.length > 0 && (
          <button
            type="button"
            className="sc-btn sc-scoreboard-open"
            onClick={() => setShowLeagues(true)}
          >
            <LayoutGrid size={14} />
            {data.teams.length} leagues
            <span style={{ marginLeft: "auto", color: "var(--sc-text-muted)" }}>
              {totalRecord.w}-{totalRecord.l}
              {totalRecord.t > 0 ? `-${totalRecord.t}` : ""}
            </span>
            <ChevronRight size={14} />
          </button>
        )}
      </header>

      <Modal
        open={showLeagues}
        onClose={() => setShowLeagues(false)}
        title="Your leagues"
        subtitle={`Week ${data.viewedWeek} · tap one for the matchup`}
      >
        <div className="sc-scoreboard-stack">
          {data.teams.map((t) => (
            <ScoreboardTile
              key={t.id}
              team={t}
              stacked
              onOpen={() => {
                setShowLeagues(false);
                if (t.matchup) openMatchup(t.id);
                else openTeam(t.id);
              }}
            />
          ))}
        </div>
      </Modal>

      <Modal
        open={showNav}
        onClose={() => setShowNav(false)}
        title="Go to"
        subtitle="Every view in the dashboard"
      >
        <div className="sc-nav-menu">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`sc-nav-btn ${tab === n.id ? "active" : ""}`}
              aria-current={tab === n.id ? "page" : undefined}
              onClick={() => {
                setTab(n.id);
                setShowNav(false);
              }}
            >
              <n.icon size={16} />
              <span>{n.label}</span>
            </button>
          ))}
        </div>
      </Modal>

      <div className="sc-body">
        {/*
          Thirteen labelled destinations. As a rail on a laptop; on a phone
          that same list was a 1,606px sideways scroll, and shrinking it to
          icons was worse — thirteen unlabelled glyphs. So the phone gets the
          view it is on, and the full labelled list one tap away.
        */}
        <nav className="sc-sidebar">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`sc-nav-btn ${tab === n.id ? "active" : ""}`}
              onClick={() => setTab(n.id)}
              aria-current={tab === n.id ? "page" : undefined}
            >
              <n.icon size={16} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        <button type="button" className="sc-nav-open" onClick={() => setShowNav(true)}>
          <activeNav.icon size={16} />
          <span>{activeNav.label}</span>
          <ChevronDown size={14} style={{ marginLeft: "auto" }} />
        </button>

        <main className="sc-content">
          {warnings.length > 0 && <WarningBanner warnings={warnings} />}

          {tab === "overview" && (
            <OverviewView
              data={data}
              onSelect={openTeam}
              onOpenMatchup={openMatchup}
            />
          )}
          {tab === "matchups" && (
            <MatchupView data={data} onSelect={setMatchupTeamId} />
          )}
          {tab === "power" && <PowerRankingsView data={data} onSelect={openTeam} />}
          {tab === "standings" && <StandingsView data={data} />}
          {tab === "teams" && (
            <TeamsView
              data={data}
              selectedTeamId={selectedTeamId}
              onSelect={setSelectedTeamId}
            />
          )}
          {tab === "players" && <PlayersView data={data} />}
          {tab === "lineups" && <LineupsView data={data} />}
          {tab === "injuries" && <InjuryWatchView data={data} />}
          {tab === "bye" && <ByeWeekView data={data} />}
          {tab === "charts" && <ChartsView data={data} />}
          {tab === "trades" && <TradesView data={data} />}
          {tab === "draft" && <DraftView data={data} />}
          {tab === "news" && <WaiverWireView data={data} />}
        </main>
      </div>

      {/*
        Mounted by the shell, not by a tab, because the scoreboard strip that
        opens it sits above every tab. Rendered inside the Matchups view it
        would only exist while that tab happened to be showing.
      */}
      <MatchupDetailModal
        data={data}
        teamId={matchupTeamId}
        onClose={() => setMatchupTeamId(null)}
      />
    </div>
  );
}

/**
 * One league's line on the cross-league scoreboard.
 *
 * The same component in both places it appears — a fixed-width tile in the
 * laptop strip, and a full-width row in the phone dialog. Rendering it twice
 * would let the two drift, and this is the thing you check first on a Sunday.
 */
function ScoreboardTile({
  team,
  onOpen,
  stacked = false,
}: {
  team: DashboardData["teams"][number];
  onOpen: () => void;
  /** Full width, for the stacked dialog list. */
  stacked?: boolean;
}) {
  return (
    <button
      className={`sc-card sc-hover sc-scoreboard-tile${stacked ? " sc-scoreboard-tile-stacked" : ""}`}
      // A scoreboard tile is about the game, so it opens the head-to-head
      // when there is one and falls back to the roster when there is not.
      onClick={onOpen}
      title={team.matchup ? "View this matchup" : "View this roster"}
    >
      <div className="sc-scoreboard-tile-top">
        <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <Avatar src={team.avatar} name={team.teamName} size={22} />
          <span className="sc-truncate sc-scoreboard-name">{team.teamName}</span>
        </span>
        <span className="sc-scoreboard-badges">
          <FormatBadge format={team.leagueFormat} />
          <PlatformBadge platform={team.platform} />
        </span>
      </div>
      <div className="sc-mono" style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>
        {team.record}
        {team.matchup?.mine.score != null && (
          <span style={{ marginLeft: 8, color: "var(--sc-text)" }}>
            {fmt(team.matchup.mine.score)}
            {team.matchup.opponent && (
              <span style={{ color: "var(--sc-text-muted)" }}>
                {" "}
                vs {fmt(team.matchup.opponent.score)}
              </span>
            )}
          </span>
        )}
      </div>
    </button>
  );
}

function WarningBanner({ warnings }: { warnings: string[] }) {
  return (
    <div
      className="sc-card"
      style={{
        padding: "10px 12px",
        marginBottom: 16,
        borderColor: "var(--sc-accent-border)",
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <AlertTriangle
        size={14}
        color="var(--sc-accent)"
        style={{ marginTop: 3, flexShrink: 0 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {warnings.map((w, i) => (
          <span key={i} style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>
            {w}
          </span>
        ))}
      </div>
    </div>
  );
}
