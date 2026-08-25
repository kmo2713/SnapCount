"use client";

/**
 * The app shell: fixed header with the cross-league scoreboard, fixed sidebar
 * nav, and a single scrolling content pane — the prototype's layout, now
 * driven by real data.
 */
import { useCallback, useMemo, useState, useTransition } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  CalendarOff,
  ClipboardList,
  HeartPulse,
  LayoutGrid,
  ListChecks,
  ListOrdered,
  Newspaper,
  RefreshCw,
  Swords,
  Trophy,
  Users,
} from "lucide-react";

import type { DashboardData } from "@/lib/domain/types";
import { PlatformBadge, fmt } from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/Avatar";

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
import { MatchupView } from "./views/MatchupView";

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

  /** Jump straight into one team’s head-to-head. */
  const openMatchup = useCallback((id: string) => {
    setMatchupTeamId(id);
    setTab("matchups");
  }, []);

  const warnings = refreshError ? [...data.warnings, refreshError] : data.warnings;

  return (
    <div className="sc-app">
      <header className="sc-header">
        <div className="sc-header-top">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="sc-wordmark">Snap Count</span>
            <span style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>
              all your fantasy teams, one screen
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
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

        {/* Cross-league scoreboard strip */}
        <div
          className="sc-scroll-x"
          style={{ display: "flex", gap: 10, marginTop: 12, paddingBottom: 4 }}
        >
          {data.teams.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--sc-text-muted)", padding: "6px 0" }}>
              No teams loaded.
            </div>
          )}
          {data.teams.map((t) => (
            <button
              key={t.id}
              className="sc-card sc-hover"
              // A scoreboard tile is about the game, so it opens the head-to-head
              // when there is one and falls back to the roster when there is not.
              onClick={() => (t.matchup ? openMatchup(t.id) : openTeam(t.id))}
              title={t.matchup ? "View this matchup" : "View this roster"}
              style={{
                flex: "0 0 auto",
                padding: "8px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 156,
                textAlign: "left",
                color: "inherit",
                font: "inherit",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <Avatar src={t.avatar} name={t.teamName} size={22} />
                  <span
                    className="sc-truncate"
                    style={{ fontSize: 12, fontWeight: 700, maxWidth: 92 }}
                  >
                    {t.teamName}
                  </span>
                </span>
                <PlatformBadge platform={t.platform} />
              </div>
              <div
                className="sc-mono"
                style={{ fontSize: 12, color: "var(--sc-text-muted)" }}
              >
                {t.record}
                {t.matchup?.mine.score != null && (
                  <span style={{ marginLeft: 8, color: "var(--sc-text)" }}>
                    {fmt(t.matchup.mine.score)}
                    {t.matchup.opponent && (
                      <span style={{ color: "var(--sc-text-muted)" }}>
                        {" "}
                        vs {fmt(t.matchup.opponent.score)}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </header>

      <div className="sc-body">
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
            <MatchupView
              data={data}
              selectedTeamId={matchupTeamId}
              onSelect={setMatchupTeamId}
              onBack={() => setMatchupTeamId(null)}
            />
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
    </div>
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
