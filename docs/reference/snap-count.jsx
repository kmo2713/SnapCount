import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LayoutGrid, Users, ListChecks, BarChart3, ArrowLeftRight, ClipboardList,
  Newspaper, Search, TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw,
  Trophy, Activity, ListOrdered, HeartPulse, CalendarOff, ChevronRight, Flame, Loader2
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell
} from "recharts";

/* ---------------------------------------------------------------
   SNAP COUNT — unified fantasy football dashboard
   SAMPLE-DATA BUILD: this chat's artifact sandbox blocks fetch()
   calls to external domains (api.sleeper.app included), so this
   version runs on realistic sample data shaped exactly like the
   real Sleeper / Yahoo / ESPN APIs. The full build (Claude Code,
   outside this sandbox) swaps this generator for real live calls.
--------------------------------------------------------------- */

const POSITION_COLORS = {
  QB: "#E2725B", RB: "#4C9A5B", WR: "#3D8BF2", TE: "#C9A63D",
  K: "#6EC6CA", DEF: "#9B7BD9", DST: "#9B7BD9", FLEX: "#9B7BD9", BN: "#5B6472",
};
function posColor(pos) { return POSITION_COLORS[pos] || "#5B6472"; }

const POSITION_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "DST"];
function sortByPosition(rows) {
  return [...rows].sort((a, b) => {
    const ai = POSITION_ORDER.indexOf(a.position);
    const bi = POSITION_ORDER.indexOf(b.position);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

const PLATFORM_META = {
  sleeper: { label: "Sleeper", color: "#4C9A5B" },
  yahoo: { label: "Yahoo", color: "#6E5BD9" },
  espn: { label: "ESPN", color: "#D9534F" },
};

/* ---------------- Player pool (used across all mock rosters/drafts) ---------------- */

const POOL_RAW = [
  ["Patrick Mahomes", "QB", "KC"], ["Josh Allen", "QB", "BUF"], ["Jalen Hurts", "QB", "PHI"],
  ["Lamar Jackson", "QB", "BAL"], ["Joe Burrow", "QB", "CIN"], ["C.J. Stroud", "QB", "HOU"],
  ["Dak Prescott", "QB", "DAL"], ["Jordan Love", "QB", "GB"],
  ["Bijan Robinson", "RB", "ATL"], ["Breece Hall", "RB", "NYJ"], ["Jahmyr Gibbs", "RB", "DET"],
  ["De'Von Achane", "RB", "MIA"], ["Kyren Williams", "RB", "LAR"], ["Jonathan Taylor", "RB", "IND"],
  ["Saquon Barkley", "RB", "PHI"], ["Derrick Henry", "RB", "BAL"], ["James Cook", "RB", "BUF"],
  ["Isiah Pacheco", "RB", "KC"], ["Rachaad White", "RB", "TB"], ["Josh Jacobs", "RB", "GB"],
  ["CeeDee Lamb", "WR", "DAL"], ["Amon-Ra St. Brown", "WR", "DET"], ["Justin Jefferson", "WR", "MIN"],
  ["A.J. Brown", "WR", "PHI"], ["Puka Nacua", "WR", "LAR"], ["Nico Collins", "WR", "HOU"],
  ["Chris Olave", "WR", "NO"], ["Garrett Wilson", "WR", "NYJ"], ["Drake London", "WR", "ATL"],
  ["DK Metcalf", "WR", "SEA"], ["Tee Higgins", "WR", "CIN"], ["Jaylen Waddle", "WR", "MIA"],
  ["Marvin Harrison Jr.", "WR", "ARI"], ["Malik Nabers", "WR", "NYG"],
  ["Travis Kelce", "TE", "KC"], ["Sam LaPorta", "TE", "DET"], ["Mark Andrews", "TE", "BAL"],
  ["Trey McBride", "TE", "ARI"], ["George Kittle", "TE", "SF"], ["Dalton Kincaid", "TE", "BUF"],
  ["Harrison Butker", "K", "KC"], ["Justin Tucker", "K", "BAL"], ["Brandon Aubrey", "K", "DAL"],
  ["Jake Elliott", "K", "PHI"],
  ["49ers D/ST", "DEF", "SF"], ["Cowboys D/ST", "DEF", "DAL"], ["Ravens D/ST", "DEF", "BAL"],
  ["Jets D/ST", "DEF", "NYJ"], ["Steelers D/ST", "DEF", "PIT"], ["Bills D/ST", "DEF", "BUF"],
];
const POOL = POOL_RAW.map(([name, position, team], i) => ({ id: `pl_${i}`, name, position, team }));
const MOCK_PLAYER_DB = Object.fromEntries(
  POOL.map((p) => [p.id, { full_name: p.name, position: p.position, team: p.team, injury_status: null }])
);

/* Mock 2026 bye-week schedule, keyed by NFL team abbreviation */
const BYE_WEEKS = {
  ATL: 5, IND: 5, KC: 6, HOU: 6, MIN: 6, BUF: 7, DAL: 7,
  BAL: 8, DET: 8, PHI: 9, NYJ: 9, NO: 9, CIN: 10, MIA: 10,
  GB: 11, LAR: 11, TB: 12, ARI: 12, SEA: 13, NYG: 13, SF: 14, PIT: 14,
};
function byeWeek(team) { return BYE_WEEKS[team] || null; }
const BYE_WEEK_LIST = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function injuryStatusFor(id) {
  const bucket = hashId(id + "inj") % 20;
  if (bucket === 0) return "Out";
  if (bucket <= 2) return "Doubtful";
  if (bucket <= 6) return "Questionable";
  return "Active";
}

function shuffled(arr) { return [...arr].sort(() => Math.random() - 0.5); }
function pickN(n) { return shuffled(POOL).slice(0, n); }
function round1(n) { return Math.round(n * 10) / 10; }

/* Deterministic per-player "value" so numbers stay stable across re-renders
   and refreshes, instead of re-randomizing on every interaction. */
function hashId(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const POSITION_BASE_VALUE = { QB: 19, RB: 15, WR: 13, TE: 9, K: 5, DEF: 5 };
function playerValue(id, position) {
  const base = POSITION_BASE_VALUE[position] || 8;
  return round1(base + (hashId(id) % 90) / 10 - 4.5);
}
function consistencyTag(id) {
  const bucket = hashId(id + "c") % 10;
  if (bucket >= 7) return { label: "Boom", color: "#4C9A5B", icon: "up" };
  if (bucket <= 1) return { label: "Volatile", color: "#D9534F", icon: "down" };
  return { label: "Steady", color: "#8B95A1", icon: "flat" };
}

/* Position depth grade: ranks a team's total value at a position against
   every other real team in the same league (mine + leagueOpponents). */
const GRADE_POSITIONS = ["QB", "RB", "WR", "TE"];
function computeTeamGrades(team, playerInfo) {
  const myRows = team.platform === "sleeper"
    ? (team.rosterIds || []).map((id) => { const info = playerInfo(id); return { position: info.position, value: playerValue(id, info.position) }; })
    : (team.roster || []).map((p) => ({ position: p.position, value: playerValue(p.player_id, p.position) }));

  const rosters = [myRows, ...(team.leagueOpponents || []).map((o) => o.roster.map((p) => ({ position: p.position, value: playerValue(p.id, p.position) })))];

  const grades = {};
  GRADE_POSITIONS.forEach((pos) => {
    const totals = rosters.map((r) => r.filter((p) => p.position === pos).reduce((s, p) => s + p.value, 0));
    const mine = totals[0];
    const better = totals.filter((t) => t <= mine).length;
    const percentile = totals.length > 1 ? better / totals.length : 1;
    let letter = "C";
    if (percentile >= 0.8) letter = "A";
    else if (percentile >= 0.6) letter = "B";
    else if (percentile >= 0.4) letter = "C";
    else if (percentile >= 0.2) letter = "D";
    else letter = "F";
    grades[pos] = { letter, percentile };
  });
  return grades;
}
const GRADE_COLOR = { A: "#4C9A5B", B: "#6EC6CA", C: "#F2A63D", D: "#E2725B", F: "#D9534F" };

const TEAM_NAME_POOL = [
  "Grid Iron Gang", "Turf Titans", "End Zone Elite", "Blitz Brigade", "Hail Mary Heroes",
  "Fumble Farmers", "Red Zone Rebels", "Draft Day Dynasty", "Comeback Kings", "Zero Dark Thirty",
  "Pigskin Pirates", "The Replacements", "Chain Gang", "Audible Avengers", "Sunday Scaries",
];

function buildDraft(teamRosterIds, teamNames, rounds) {
  const picks = [];
  let pickNo = 1;
  for (let r = 1; r <= rounds; r++) {
    const order = r % 2 === 1 ? teamRosterIds : [...teamRosterIds].reverse();
    order.forEach((rosterId, idx) => {
      const p = POOL[Math.floor(Math.random() * POOL.length)];
      picks.push({
        pick_no: pickNo++, round: r, roster_id: rosterId,
        picked_by: teamNames[teamRosterIds.indexOf(rosterId)],
        metadata: { first_name: p.name.split(" ")[0], last_name: p.name.split(" ").slice(1).join(" "), position: p.position, team: p.team },
      });
    });
  }
  return picks;
}

function buildSleeperLeague({ leagueId, name, teamCount, rounds, myUserId, myTeamName, myRosterSlots }) {
  const rosterIds = Array.from({ length: teamCount }, (_, i) => i + 1);
  const names = [myTeamName, ...shuffled(TEAM_NAME_POOL).slice(0, teamCount - 1)];
  const users = rosterIds.map((id, i) => ({
    user_id: id === 1 ? myUserId : `bot_${leagueId}_${id}`,
    display_name: names[i],
    metadata: { team_name: names[i] },
  }));

  const rosters = rosterIds.map((id) => {
    const isMine = id === 1;
    const players = pickN(15);
    const wins = Math.floor(Math.random() * 6) + (isMine ? 2 : 0);
    const losses = Math.floor(Math.random() * 5);
    return {
      roster_id: id, owner_id: id === 1 ? myUserId : users[id - 1].user_id,
      players: players.map((p) => p.id),
      starters: isMine ? players.slice(0, myRosterSlots).map((p) => p.id) : [],
      settings: {
        wins, losses, ties: 0,
        fpts: Math.floor(800 + Math.random() * 400), fpts_decimal: Math.floor(Math.random() * 99),
        fpts_against: Math.floor(750 + Math.random() * 400), fpts_decimal_against: Math.floor(Math.random() * 99),
      },
    };
  });

  const week = 4;
  const matchups = [];
  for (let i = 0; i < rosterIds.length; i += 2) {
    const a = rosterIds[i], b = rosterIds[i + 1];
    const matchupId = i / 2 + 1;
    matchups.push({ roster_id: a, matchup_id: matchupId, points: round1(70 + Math.random() * 70) });
    if (b) matchups.push({ roster_id: b, matchup_id: matchupId, points: round1(70 + Math.random() * 70) });
  }

  const weeklyPoints = Array.from({ length: week - 1 }, (_, i) => ({ week: `W${i + 1}`, points: round1(85 + Math.random() * 55) }));

  return {
    league: { league_id: leagueId, name, roster_positions: Array(myRosterSlots).fill("STARTER").concat(["BN", "BN", "BN", "BN", "BN"]) },
    rosters, users, matchups, week, season: "2026",
    draftPicks: buildDraft(rosterIds, names, rounds),
    weeklyPoints,
  };
}

function buildMockUniverse() {
  const myUserId = "mock_kmo2713";
  const leagues = [
    buildSleeperLeague({ leagueId: "lg_1", name: "Friends & Family Redraft", teamCount: 10, rounds: 12, myUserId, myTeamName: "Cash Money Crew", myRosterSlots: 8 }),
    buildSleeperLeague({ leagueId: "lg_2", name: "Dynasty Vets Superflex", teamCount: 12, rounds: 10, myUserId, myTeamName: "Vintage Value", myRosterSlots: 9 }),
    buildSleeperLeague({ leagueId: "lg_3", name: "Work League Redraft", teamCount: 8, rounds: 10, myUserId, myTeamName: "The Comeback Kids", myRosterSlots: 8 }),
  ];
  const trending = shuffled(POOL).slice(0, 12).map((p, i) => ({ player_id: p.id, count: Math.floor(4000 - i * 220 + Math.random() * 300) }));
  return {
    nflState: { season: "2026", week: 4, season_type: "regular" },
    sleeperUser: { user_id: myUserId, username: "kmo2713", display_name: "kmo2713" },
    sleeperLeagues: leagues,
    trending,
  };
}

function buildMockOpponents(platform, id, names, oppName, oppScore) {
  return names.map((name, i) => {
    const wins = Math.floor(Math.random() * 8);
    const losses = Math.floor(Math.random() * 6);
    return {
      id: `${platform}-${id}-opp-${i}`, name, wins, losses,
      pointsFor: round1(700 + Math.random() * 500),
      weekScore: name === oppName ? oppScore : round1(60 + Math.random() * 80),
      roster: pickN(9).map((p, j) => ({ id: `${platform}-${id}-opp-${i}-${j}`, name: p.name, position: p.position, team: p.team })),
    };
  });
}
function buildMockTeam(platform, id, name, wins, losses, forPts, oppPts, myScore, oppScore, oppName) {
  const roster = pickN(9).map((p, i) => ({
    player_id: `${platform}-${id}-${i}`, name: p.name, position: p.position, team: p.team,
    points: round1(Math.random() * 22), projected: round1(Math.random() * 20 + 4),
    status: Math.random() > 0.88 ? "Questionable" : "Active",
  }));
  const opponentNames = shuffled(TEAM_NAME_POOL).slice(0, 4);
  if (!opponentNames.includes(oppName)) opponentNames[0] = oppName;
  return {
    id: `${platform}-${id}`, platform, leagueName: name, teamName: `Team ${id}`,
    record: `${wins}-${losses}`, wins, losses, pointsFor: forPts, pointsAgainst: oppPts,
    week: { myScore, oppScore, oppName }, roster, starters: roster.slice(0, 6).map((p) => p.player_id),
    leagueOpponents: buildMockOpponents(platform, id, opponentNames, oppName, oppScore),
  };
}
function makeMockTeams() {
  return [
    buildMockTeam("yahoo", 1, "The Office League", 6, 2, 1042.4, 921.0, 118.2, 104.5, "Gridiron Gurus"),
    buildMockTeam("yahoo", 2, "Family Ties Dynasty", 4, 4, 889.6, 901.2, 95.6, 110.3, "Cousin Eddie's Team"),
    buildMockTeam("espn", 1, "College Buddies", 7, 1, 1103.8, 890.4, 132.0, 88.9, "Waiver Wire Wizards"),
    buildMockTeam("espn", 2, "Work Slack League", 3, 5, 812.1, 940.7, 90.4, 121.1, "Draft Day Disaster"),
  ];
}

/* ---------------------------- Small UI bits ---------------------------- */

function PlatformBadge({ platform }) {
  const meta = PLATFORM_META[platform] || { label: platform, color: "#888" };
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      color: meta.color, border: `1px solid ${meta.color}55`, background: `${meta.color}1A`,
      padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
    }}>{meta.label}</span>
  );
}
function PosTag({ pos }) {
  const c = posColor(pos);
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, color: c, border: `1px solid ${c}66`,
      background: `${c}22`, padding: "1px 6px", borderRadius: 4, minWidth: 30,
      textAlign: "center", display: "inline-block",
    }}>{pos}</span>
  );
}
function EmptyState({ icon: Icon, title, body }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "56px 24px", color: "var(--sc-text-muted)", textAlign: "center", gap: 8 }}>
      <Icon size={28} strokeWidth={1.5} />
      <div style={{ fontWeight: 700, color: "var(--sc-text)", fontSize: 15 }}>{title}</div>
      <div style={{ fontSize: 13, maxWidth: 360 }}>{body}</div>
    </div>
  );
}
function Loading({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "40px 0", color: "var(--sc-text-muted)", justifyContent: "center" }}>
      <Loader2 size={18} className="spin" />
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  );
}

/* ------------------------------ App ------------------------------ */

export default function App() {
  const [tab, setTab] = useState("overview");
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [universe, setUniverse] = useState(null);
  const [mockTeams, setMockTeams] = useState(() => makeMockTeams());

  const refresh = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      setUniverse(buildMockUniverse());
      setMockTeams(makeMockTeams());
      setLoading(false);
    }, 550);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const sleeperTeams = useMemo(() => {
    if (!universe) return [];
    const out = [];
    universe.sleeperLeagues.forEach((entry) => {
      const { league, rosters, users, matchups, week, weeklyPoints } = entry;
      const userById = Object.fromEntries(users.map((u) => [u.user_id, u]));
      const matchupByRoster = Object.fromEntries(matchups.map((m) => [m.roster_id, m]));
      const mine = rosters.find((r) => r.owner_id === universe.sleeperUser.user_id);
      if (!mine) return;
      const owner = userById[mine.owner_id];
      const teamName = owner?.metadata?.team_name || owner?.display_name || `Roster ${mine.roster_id}`;
      const m = matchupByRoster[mine.roster_id];
      let oppScore = null, oppName = null, myScore = m?.points ?? null;
      if (m) {
        const opp = matchups.find((x) => x.matchup_id === m.matchup_id && x.roster_id !== mine.roster_id);
        if (opp) {
          oppScore = opp.points;
          const oppOwner = userById[(rosters.find((r) => r.roster_id === opp.roster_id) || {}).owner_id];
          oppName = oppOwner?.metadata?.team_name || oppOwner?.display_name || `Roster ${opp.roster_id}`;
        }
      }
      const leagueOpponents = rosters
        .filter((r) => r.roster_id !== mine.roster_id)
        .map((r) => {
          const u = userById[r.owner_id];
          const rm = matchupByRoster[r.roster_id];
          return {
            id: `sleeper-${league.league_id}-${r.roster_id}`,
            name: u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}`,
            wins: r.settings.wins, losses: r.settings.losses,
            pointsFor: r.settings.fpts + r.settings.fpts_decimal / 100,
            weekScore: rm?.points ?? null,
            roster: (r.players || []).map((pid) => ({ id: pid, ...(MOCK_PLAYER_DB[pid] ? { name: MOCK_PLAYER_DB[pid].full_name, position: MOCK_PLAYER_DB[pid].position, team: MOCK_PLAYER_DB[pid].team } : { name: pid, position: "\u2014", team: "" }) })),
          };
        });
      out.push({
        id: `sleeper-${league.league_id}-${mine.roster_id}`, platform: "sleeper",
        leagueId: league.league_id, leagueName: league.name, teamName,
        record: `${mine.settings.wins}-${mine.settings.losses}${mine.settings.ties ? "-" + mine.settings.ties : ""}`,
        wins: mine.settings.wins, losses: mine.settings.losses,
        pointsFor: mine.settings.fpts + mine.settings.fpts_decimal / 100,
        pointsAgainst: mine.settings.fpts_against + mine.settings.fpts_decimal_against / 100,
        week: { myScore, oppScore, oppName, week },
        rosterIds: mine.players, starterIds: mine.starters, weeklyPoints, leagueOpponents,
      });
    });
    return out;
  }, [universe]);

  const allTeams = useMemo(() => [...sleeperTeams, ...mockTeams], [sleeperTeams, mockTeams]);
  const totalRecord = useMemo(() => {
    let w = 0, l = 0;
    allTeams.forEach((t) => { w += t.wins || 0; l += t.losses || 0; });
    return { w, l };
  }, [allTeams]);

  function playerInfo(id) {
    const p = MOCK_PLAYER_DB[id];
    if (!p) return { name: id, position: "\u2014", team: "" };
    return { name: p.full_name, position: p.position, team: p.team, status: injuryStatusFor(id) };
  }

  const NAV = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
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

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: "#10151A", color: "#F5F3EE", height: 760, borderRadius: 12, overflow: "hidden", border: "1px solid #2A323B", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
        .sc-root, .sc-root * { box-sizing: border-box; }
        .spin { animation: sc-spin 1s linear infinite; }
        @keyframes sc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .sc-scoreboard::-webkit-scrollbar { height: 6px; }
        .sc-scoreboard::-webkit-scrollbar-thumb { background: #2A323B; border-radius: 4px; }
        .sc-card { background: #161C22; border: 1px solid #2A323B; border-radius: 10px; }
        .sc-card.sc-hover:hover { border-color: #F2A63D; cursor: pointer; }
        .sc-nav-btn { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600; color:#8B95A1; border:none; background:transparent; width:100%; text-align:left; }
        .sc-nav-btn:hover { background: #1D242B; color: #F5F3EE; }
        .sc-nav-btn.active { background: #F2A63D1A; color: #F2A63D; }
        table.sc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        table.sc-table th { text-align: left; color: #8B95A1; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; padding: 8px 10px; border-bottom: 1px solid #2A323B; }
        table.sc-table td { padding: 8px 10px; border-bottom: 1px solid #20272E; vertical-align: middle; }
        table.sc-table tr:last-child td { border-bottom: none; }
        table.sc-table tbody tr:hover { background: #1D242B; }
        .sc-btn { background: #1D242B; border: 1px solid #2A323B; color: #F5F3EE; border-radius: 8px; padding: 7px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .sc-btn:hover { border-color: #F2A63D; }
        .sc-input { background: #1D242B; border: 1px solid #2A323B; color: #F5F3EE; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
        .sc-select { background: #1D242B; border: 1px solid #2A323B; color: #F5F3EE; border-radius: 8px; padding: 7px 10px; font-size: 13px; }
      `}</style>

      <div className="sc-root" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #2A323B", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: 1, textTransform: "uppercase" }}>Snap Count</span>
              <span style={{ fontSize: 12, color: "#8B95A1" }}>all your fantasy teams, one screen</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 18, color: "#F2A63D" }}>{totalRecord.w}-{totalRecord.l}</div>
                <div style={{ fontSize: 10, color: "#8B95A1", textTransform: "uppercase", letterSpacing: 0.5 }}>combined record</div>
              </div>
              <button className="sc-btn" onClick={refresh} disabled={loading} title="Reshuffle sample data">
                <RefreshCw size={14} className={loading ? "spin" : ""} style={{ verticalAlign: -2 }} />
              </button>
            </div>
          </div>

          <div className="sc-scoreboard" style={{ display: "flex", gap: 10, overflowX: "auto", marginTop: 14, paddingBottom: 4 }}>
            {loading && <div style={{ fontSize: 12, color: "#8B95A1", padding: "6px 0" }}>Loading your leagues…</div>}
            {!loading && allTeams.map((t) => (
              <div key={t.id} className="sc-card" style={{ flex: "0 0 auto", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4, minWidth: 148 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 90 }}>{t.teamName}</span>
                  <PlatformBadge platform={t.platform} />
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#8B95A1" }}>
                  {t.record}
                  {t.week?.myScore != null && (
                    <span style={{ marginLeft: 8, color: "#F5F3EE" }}>
                      {Number(t.week.myScore).toFixed(1)}
                      {t.week.oppScore != null && <span style={{ color: "#8B95A1" }}> vs {Number(t.week.oppScore).toFixed(1)}</span>}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ width: 168, padding: 14, borderRight: "1px solid #2A323B", display: "flex", flexDirection: "column", gap: 3, flexShrink: 0, overflow: "hidden" }}>
            {NAV.map((n) => (
              <button key={n.id} className={`sc-nav-btn ${tab === n.id ? "active" : ""}`} onClick={() => setTab(n.id)}>
                <n.icon size={16} />{n.label}
              </button>
            ))}
            <div style={{ marginTop: "auto", paddingTop: 14, fontSize: 11, color: "#8B95A1", lineHeight: 1.5 }}>
              Sample data, shaped like the real Sleeper / Yahoo / ESPN APIs. Hit refresh to reshuffle.
            </div>
          </div>

          <div style={{ flex: 1, padding: 20, minWidth: 0, overflowY: "auto" }}>
            {tab === "overview" && <OverviewView teams={allTeams} loading={loading} playerInfo={playerInfo} trending={universe?.trending || []} onSelect={(id) => { setSelectedTeamId(id); setTab("teams"); }} />}
            {tab === "power" && <PowerRankingsView teams={allTeams} loading={loading} playerInfo={playerInfo} onSelect={(id) => { setSelectedTeamId(id); setTab("teams"); }} />}
            {tab === "standings" && <StandingsView teams={allTeams} loading={loading} />}
            {tab === "teams" && <TeamsView teams={allTeams} loading={loading} playerInfo={playerInfo} selectedTeamId={selectedTeamId} setSelectedTeamId={setSelectedTeamId} />}
            {tab === "players" && <PlayersView teams={allTeams} loading={loading} playerInfo={playerInfo} />}
            {tab === "lineups" && <LineupsView teams={allTeams} loading={loading} playerInfo={playerInfo} />}
            {tab === "injuries" && <InjuryWatchView teams={allTeams} loading={loading} playerInfo={playerInfo} />}
            {tab === "bye" && <ByeWeekView teams={allTeams} loading={loading} playerInfo={playerInfo} />}
            {tab === "charts" && <ChartsView sleeperTeams={sleeperTeams} allTeams={allTeams} loading={loading} />}
            {tab === "trades" && <TradesView teams={allTeams} loading={loading} playerInfo={playerInfo} />}
            {tab === "draft" && <DraftView sleeperLeagues={universe?.sleeperLeagues || []} loading={loading} />}
            {tab === "news" && <NewsView trending={universe?.trending || []} teams={allTeams} playerInfo={playerInfo} loading={loading} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Overview ------------------------------ */

function buildBriefing(teams, playerInfo, trending) {
  const items = [];

  let injuredStarters = [];
  teams.forEach((t) => {
    const starterIds = t.platform === "sleeper" ? (t.starterIds || []) : (t.starters || []);
    starterIds.forEach((id) => {
      const info = t.platform === "sleeper" ? playerInfo(id) : (t.roster || []).find((p) => p.player_id === id);
      if (info && info.status && info.status !== "Active") injuredStarters.push({ team: t, name: info.name, status: info.status });
    });
  });
  if (injuredStarters.length > 0) {
    items.push({
      icon: AlertTriangle, color: "#D9534F",
      text: `${injuredStarters.length} starter${injuredStarters.length > 1 ? "s are" : " is"} banged up: ${injuredStarters.slice(0, 2).map((x) => `${x.name} (${x.status})`).join(", ")}${injuredStarters.length > 2 ? `, +${injuredStarters.length - 2} more` : ""}.`,
    });
  }

  let swaps = 0;
  teams.forEach((t) => {
    const starterIds = t.platform === "sleeper" ? (t.starterIds || []) : (t.starters || []);
    const benchIds = t.platform === "sleeper" ? (t.rosterIds || []).filter((id) => !starterIds.includes(id)) : (t.roster || []).map((p) => p.player_id).filter((id) => !starterIds.includes(id));
    starterIds.forEach((sid) => {
      const sInfo = t.platform === "sleeper" ? { ...playerInfo(sid), value: playerValue(sid, playerInfo(sid).position) } : (() => { const p = (t.roster || []).find((x) => x.player_id === sid); return p ? { position: p.position, value: p.points } : null; })();
      if (!sInfo) return;
      const better = benchIds.some((bid) => {
        const bInfo = t.platform === "sleeper" ? { ...playerInfo(bid), value: playerValue(bid, playerInfo(bid).position) } : (() => { const p = (t.roster || []).find((x) => x.player_id === bid); return p ? { position: p.position, value: p.points } : null; })();
        return bInfo && bInfo.position === sInfo.position && bInfo.value > sInfo.value;
      });
      if (better) swaps++;
    });
  });
  if (swaps > 0) items.push({ icon: Flame, color: "#F2A63D", text: `${swaps} possible start/sit upgrade${swaps > 1 ? "s" : ""} waiting in Lineups.` });

  const closest = teams.filter((t) => t.week?.myScore != null && t.week?.oppScore != null)
    .sort((a, b) => Math.abs(a.week.myScore - a.week.oppScore) - Math.abs(b.week.myScore - b.week.oppScore))[0];
  if (closest) {
    const margin = Math.abs(closest.week.myScore - closest.week.oppScore).toFixed(1);
    items.push({ icon: Activity, color: "#6EC6CA", text: `${closest.teamName} has the closest matchup this week \u2014 within ${margin} points.` });
  }

  const myPlayerIds = new Set();
  teams.forEach((t) => { if (t.platform === "sleeper") (t.rosterIds || []).forEach((id) => myPlayerIds.add(id)); });
  const trendRows = (trending || []).map((tr) => ({ ...tr, ...playerInfo(tr.player_id) }));
  teams.forEach((t) => {
    if (items.length >= 5) return;
    const grades = computeTeamGrades(t, playerInfo);
    const weakest = GRADE_POSITIONS.map((p) => ({ pos: p, ...grades[p] })).sort((a, b) => a.percentile - b.percentile)[0];
    if (!weakest || weakest.percentile > 0.45) return;
    const rec = trendRows.find((r) => r.position === weakest.pos && !myPlayerIds.has(r.player_id));
    if (rec) items.push({ icon: TrendingUp, color: "#4C9A5B", text: `${rec.name} is trending and could help ${t.teamName}'s ${weakest.pos} spot.` });
  });

  return items.slice(0, 5);
}

function BriefingCard({ teams, playerInfo, trending }) {
  const items = buildBriefing(teams, playerInfo, trending);
  if (items.length === 0) return null;
  return (
    <div className="sc-card" style={{ padding: 14, marginBottom: 20, borderColor: "#F2A63D44" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#F2A63D", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>This week</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, lineHeight: 1.4 }}>
            <it.icon size={14} color={it.color} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{it.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewView({ teams, loading, playerInfo, trending, onSelect }) {
  if (loading) return <Loading label="Pulling your leagues and rosters\u2026" />;
  if (teams.length === 0) return <EmptyState icon={Users} title="No teams found" body="Nothing to show yet." />;
  const best = [...teams].sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses))[0];
  const closest = teams.filter((t) => t.week?.myScore != null && t.week?.oppScore != null)
    .sort((a, b) => Math.abs(a.week.myScore - a.week.oppScore) - Math.abs(b.week.myScore - b.week.oppScore))[0];

  return (
    <div>
      <BriefingCard teams={teams} playerInfo={playerInfo} trending={trending} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        <MetricCard label="Total teams" value={teams.length} />
        <MetricCard label="Best record" value={best ? `${best.wins}-${best.losses}` : "\u2014"} sub={best?.teamName} />
        <MetricCard label="Closest matchup" value={closest ? `${Math.abs(closest.week.myScore - closest.week.oppScore).toFixed(1)} pts` : "\u2014"} sub={closest?.teamName} />
        <MetricCard label="Platforms" value={new Set(teams.map((t) => t.platform)).size} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "#8B95A1", textTransform: "uppercase", letterSpacing: 0.4 }}>All teams</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
        {teams.map((t) => (
          <div key={t.id} className="sc-card sc-hover" onClick={() => onSelect(t.id)} style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t.teamName}</div>
                <div style={{ fontSize: 11, color: "#8B95A1" }}>{t.leagueName}</div>
              </div>
              <PlatformBadge platform={t.platform} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, fontWeight: 600 }}>{t.record}</div>
                <div style={{ fontSize: 11, color: "#8B95A1" }}>{(t.pointsFor || 0).toFixed(1)} PF</div>
              </div>
              {t.week?.myScore != null ? (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "#8B95A1" }}>this week</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 14 }}>
                    {Number(t.week.myScore).toFixed(1)}{t.week.oppScore != null && <span style={{ color: "#8B95A1" }}> – {Number(t.week.oppScore).toFixed(1)}</span>}
                  </div>
                </div>
              ) : <div style={{ fontSize: 11, color: "#8B95A1" }}>no matchup yet</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub }) {
  return (
    <div className="sc-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11, color: "#8B95A1", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#8B95A1", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
    </div>
  );
}

/* ------------------------------ Power rankings ------------------------------ */

function playoffOdds(t) {
  const games = (t.wins || 0) + (t.losses || 0) || 1;
  const winPct = (t.wins || 0) / games;
  const diff = (t.pointsFor || 0) - (t.pointsAgainst || 0);
  const odds = 50 + (winPct - 0.5) * 90 + diff / 15;
  return Math.max(3, Math.min(97, Math.round(odds)));
}
function compositeScore(t) {
  const games = (t.wins || 0) + (t.losses || 0) || 1;
  const winPct = (t.wins || 0) / games;
  const diff = (t.pointsFor || 0) - (t.pointsAgainst || 0);
  return winPct * 70 + Math.max(-30, Math.min(30, diff / 8));
}

function PowerRankingsView({ teams, loading, playerInfo, onSelect }) {
  if (loading) return <Loading label="Crunching records and scoring margins\u2026" />;
  if (teams.length === 0) return <EmptyState icon={Activity} title="No teams yet" body="Nothing to rank." />;

  const ranked = [...teams].map((t) => ({ ...t, score: compositeScore(t), odds: playoffOdds(t) })).sort((a, b) => b.score - a.score);
  const maxScore = Math.max(...ranked.map((t) => t.score), 1);

  return (
    <div>
      <div style={{ fontSize: 12, color: "#8B95A1", marginBottom: 16, lineHeight: 1.5 }}>
        Ranked across all your teams by a blend of record and scoring margin. Playoff odds are a simple
        estimate from current record and point differential — not a full season simulation.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ranked.map((t, i) => {
          const grades = computeTeamGrades(t, playerInfo);
          const tier = i < Math.ceil(ranked.length * 0.34) ? { label: "Contender", color: "#4C9A5B" }
            : i < Math.ceil(ranked.length * 0.67) ? { label: "Bubble", color: "#F2A63D" }
            : { label: "Rebuilding", color: "#D9534F" };
          return (
            <div key={t.id} className="sc-card sc-hover" onClick={() => onSelect(t.id)} style={{ padding: 14, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 20, fontWeight: 700, color: "#8B95A1", width: 26, textAlign: "center" }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.teamName}</span>
                  <PlatformBadge platform={t.platform} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: tier.color, border: `1px solid ${tier.color}55`, background: `${tier.color}1A`, padding: "1px 7px", borderRadius: 999 }}>{tier.label}</span>
                </div>
                <div style={{ height: 5, background: "#20272E", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
                  <div style={{ height: "100%", width: `${Math.max(4, (t.score / maxScore) * 100)}%`, background: tier.color }} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {GRADE_POSITIONS.map((pos) => (
                    <span key={pos} style={{ fontSize: 10, fontWeight: 700, color: GRADE_COLOR[grades[pos].letter], border: `1px solid ${GRADE_COLOR[grades[pos].letter]}55`, padding: "1px 6px", borderRadius: 4 }}>{pos} {grades[pos].letter}</span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, fontWeight: 700 }}>{t.record}</div>
                <div style={{ fontSize: 11, color: "#8B95A1" }}>{t.odds}% playoff odds</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ Teams / drill-in ------------------------------ */

/* ------------------------------ Standings ------------------------------ */

function StandingsView({ teams, loading }) {
  if (loading) return <Loading label="Loading standings\u2026" />;
  if (teams.length === 0) return <EmptyState icon={ListOrdered} title="No leagues yet" body="Nothing to show." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {teams.map((t) => {
        const rows = [
          { name: t.teamName, wins: t.wins, losses: t.losses, pointsFor: t.pointsFor, mine: true },
          ...(t.leagueOpponents || []).map((o) => ({ name: o.name, wins: o.wins, losses: o.losses, pointsFor: o.pointsFor, mine: false })),
        ].sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses) || b.pointsFor - a.pointsFor);

        return (
          <div key={t.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{t.leagueName}</div>
              <PlatformBadge platform={t.platform} />
            </div>
            <table className="sc-table">
              <thead><tr><th>Rank</th><th>Team</th><th>Record</th><th>Points for</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={r.mine ? { background: "#F2A63D14" } : undefined}>
                    <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{i + 1}</td>
                    <td style={{ fontWeight: r.mine ? 700 : 500, color: r.mine ? "#F2A63D" : "#F5F3EE" }}>{r.name}{r.mine && " (you)"}</td>
                    <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{r.wins}-{r.losses}</td>
                    <td style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#8B95A1" }}>{(r.pointsFor || 0).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ Injury watch ------------------------------ */

const INJURY_SEVERITY = { Out: 3, Doubtful: 2, Questionable: 1 };

function InjuryWatchView({ teams, loading, playerInfo }) {
  if (loading) return <Loading label="Checking injury reports\u2026" />;

  const rows = [];
  teams.forEach((t) => {
    const starterIds = t.platform === "sleeper" ? (t.starterIds || []) : (t.starters || []);
    if (t.platform === "sleeper") {
      (t.rosterIds || []).forEach((id) => {
        const info = playerInfo(id);
        if (info.status && info.status !== "Active") rows.push({ id: `${t.id}-${id}`, ...info, starter: starterIds.includes(id), teamName: t.teamName, leagueName: t.leagueName, platform: t.platform });
      });
    } else {
      (t.roster || []).forEach((p) => {
        if (p.status && p.status !== "Active") rows.push({ id: `${t.id}-${p.player_id}`, name: p.name, position: p.position, team: p.team, status: p.status, starter: starterIds.includes(p.player_id), teamName: t.teamName, leagueName: t.leagueName, platform: t.platform });
      });
    }
  });
  rows.sort((a, b) => (b.starter - a.starter) || ((INJURY_SEVERITY[b.status] || 0) - (INJURY_SEVERITY[a.status] || 0)));

  if (loading) return null;
  if (rows.length === 0) return <EmptyState icon={HeartPulse} title="No injuries flagged" body="Every rostered player across your teams is listed active." />;

  return (
    <div>
      <div style={{ fontSize: 12, color: "#8B95A1", marginBottom: 14, lineHeight: 1.5 }}>
        Every non-active player across all your teams, starters first. {rows.filter((r) => r.starter).length} of these are currently in a starting lineup.
      </div>
      <table className="sc-table">
        <thead><tr><th>Pos</th><th>Player</th><th>NFL team</th><th>Status</th><th>Role</th><th>Fantasy team</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><PosTag pos={r.position} /></td>
              <td style={{ fontWeight: 600 }}>{r.name}</td>
              <td style={{ color: "#8B95A1" }}>{r.team}</td>
              <td><span style={{ color: r.status === "Out" ? "#D9534F" : r.status === "Doubtful" ? "#E2725B" : "#F2A63D", fontSize: 12, fontWeight: 700 }}>{r.status}</span></td>
              <td>{r.starter ? <span style={{ fontSize: 11, fontWeight: 700, color: "#F2A63D" }}>STARTING</span> : <span style={{ fontSize: 11, color: "#8B95A1" }}>Bench</span>}</td>
              <td style={{ display: "flex", alignItems: "center", gap: 6 }}><PlatformBadge platform={r.platform} /> <span style={{ fontSize: 11, color: "#8B95A1" }}>{r.teamName}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Bye weeks ------------------------------ */

function ByeWeekView({ teams, loading, playerInfo }) {
  if (loading) return <Loading label="Mapping bye weeks\u2026" />;
  if (teams.length === 0) return <EmptyState icon={CalendarOff} title="No teams yet" body="Nothing to show." />;

  const table = teams.map((t) => {
    const starterIds = t.platform === "sleeper" ? (t.starterIds || []) : (t.starters || []);
    const starterInfo = starterIds.map((id) => t.platform === "sleeper" ? { id, ...playerInfo(id) } : (t.roster || []).find((p) => p.player_id === id)).filter(Boolean);
    const byWeek = {};
    BYE_WEEK_LIST.forEach((w) => { byWeek[w] = []; });
    starterInfo.forEach((p) => {
      const w = byeWeek(p.team);
      if (w && byWeek[w]) byWeek[w].push(p);
    });
    return { team: t, byWeek };
  });

  const collisions = [];
  table.forEach(({ team, byWeek }) => {
    BYE_WEEK_LIST.forEach((w) => { if (byWeek[w].length >= 2) collisions.push({ team, week: w, players: byWeek[w] }); });
  });

  return (
    <div>
      <div style={{ fontSize: 12, color: "#8B95A1", marginBottom: 16, lineHeight: 1.5 }}>
        Counts of your starters on bye each week. Two or more starters sharing a bye is a scramble
        week worth planning for early.
      </div>
      <div style={{ overflowX: "auto", marginBottom: 20 }}>
        <table className="sc-table" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Team</th>
              {BYE_WEEK_LIST.map((w) => <th key={w} style={{ textAlign: "center" }}>W{w}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.map(({ team, byWeek }) => (
              <tr key={team.id}>
                <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{team.teamName}</td>
                {BYE_WEEK_LIST.map((w) => {
                  const n = byWeek[w].length;
                  const color = n >= 2 ? "#D9534F" : n === 1 ? "#F2A63D" : "#8B95A1";
                  return <td key={w} style={{ textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", color, fontWeight: n >= 2 ? 700 : 400 }}>{n || "\u2013"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: "#8B95A1", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Bye collisions</div>
      {collisions.length === 0 ? (
        <EmptyState icon={CalendarOff} title="No collisions" body="No team has two starters sharing a bye week." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {collisions.map((c, i) => (
            <div key={i} className="sc-card" style={{ padding: "10px 12px", borderColor: "#D9534F44" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{c.team.teamName} — Week {c.week}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {c.players.map((p, j) => (
                  <span key={j} style={{ fontSize: 12, color: "#8B95A1", display: "flex", alignItems: "center", gap: 4 }}><PosTag pos={p.position} />{p.name}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamsView({ teams, loading, playerInfo, selectedTeamId, setSelectedTeamId }) {
  const team = teams.find((t) => t.id === selectedTeamId) || teams[0];
  if (loading) return <Loading label="Loading rosters\u2026" />;
  if (!team) return <EmptyState icon={Users} title="No teams" body="Nothing to show yet." />;
  const isSleeper = team.platform === "sleeper";
  const rosterRows = isSleeper
    ? (team.rosterIds || []).map((pid) => ({ id: pid, ...playerInfo(pid), starter: (team.starterIds || []).includes(pid) }))
    : (team.roster || []).map((p) => ({ id: p.player_id, name: p.name, position: p.position, team: p.team, status: p.status, starter: (team.starters || []).includes(p.player_id) }));
  const starters = sortByPosition(rosterRows.filter((r) => r.starter));
  const bench = sortByPosition(rosterRows.filter((r) => !r.starter));

  return (
    <div style={{ display: "flex", gap: 18 }}>
      <div style={{ width: 210, flexShrink: 0, alignSelf: "flex-start", position: "sticky", top: 0 }}>
        <div style={{ fontSize: 11, color: "#8B95A1", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Your teams</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 460, overflowY: "auto" }}>
          {teams.map((t) => (
            <button key={t.id} onClick={() => setSelectedTeamId(t.id)} className="sc-nav-btn" style={{ justifyContent: "space-between", background: t.id === team.id ? "#1D242B" : "transparent", color: t.id === team.id ? "#F5F3EE" : "#8B95A1" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.teamName}</span>
              <ChevronRight size={13} />
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{team.teamName}</div>
            <div style={{ fontSize: 12, color: "#8B95A1" }}>{team.leagueName}</div>
          </div>
          <PlatformBadge platform={team.platform} />
        </div>
        <div style={{ display: "flex", gap: 12, margin: "14px 0" }}>
          <div className="sc-card" style={{ padding: 12, flex: 1 }}>
            <div style={{ fontSize: 11, color: "#8B95A1" }}>Record</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>{team.record}</div>
          </div>
          <div className="sc-card" style={{ padding: 12, flex: 1 }}>
            <div style={{ fontSize: 11, color: "#8B95A1" }}>Points for</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>{(team.pointsFor || 0).toFixed(1)}</div>
          </div>
          {team.week?.myScore != null && (
            <div className="sc-card" style={{ padding: 12, flex: 1 }}>
              <div style={{ fontSize: 11, color: "#8B95A1" }}>This week vs {team.week.oppName || "opponent"}</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>{Number(team.week.myScore).toFixed(1)}{team.week.oppScore != null && ` \u2013 ${Number(team.week.oppScore).toFixed(1)}`}</div>
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: "#8B95A1", textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 8px" }}>Position grades vs. league</div>
        <GradeRow team={team} playerInfo={playerInfo} />

        <div style={{ fontSize: 12, fontWeight: 700, color: "#8B95A1", textTransform: "uppercase", letterSpacing: 0.4, margin: "18px 0 8px" }}>Starters</div>
        <RosterTable rows={starters} />
        <div style={{ fontSize: 12, fontWeight: 700, color: "#8B95A1", textTransform: "uppercase", letterSpacing: 0.4, margin: "18px 0 8px" }}>Bench</div>
        <RosterTable rows={bench} />
      </div>
    </div>
  );
}

function GradeRow({ team, playerInfo }) {
  const grades = computeTeamGrades(team, playerInfo);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
      {GRADE_POSITIONS.map((pos) => <GradeChip key={pos} pos={pos} grade={grades[pos]} />)}
    </div>
  );
}
function GradeChip({ pos, grade }) {
  const c = GRADE_COLOR[grade.letter];
  return (
    <div className="sc-card" style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, flex: "1 1 100px" }}>
      <div style={{ fontSize: 11, color: "#8B95A1", fontWeight: 700 }}>{pos}</div>
      <div style={{ marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, color: c }}>{grade.letter}</div>
    </div>
  );
}

function RosterTable({ rows }) {
  if (rows.length === 0) return <div style={{ fontSize: 12, color: "#8B95A1" }}>Empty.</div>;
  return (
    <table className="sc-table">
      <thead><tr><th>Pos</th><th>Player</th><th>Team</th><th>Status</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><PosTag pos={r.position} /></td>
            <td style={{ fontWeight: 600 }}>{r.name}</td>
            <td style={{ color: "#8B95A1" }}>{r.team}</td>
            <td>{r.status && r.status !== "Active" ? (
              <span style={{ color: "#D9534F", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} /> {r.status}</span>
            ) : <span style={{ color: "#8B95A1", fontSize: 12 }}>Active</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------ Players ------------------------------ */

function PlayersView({ teams, loading, playerInfo }) {
  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [platFilter, setPlatFilter] = useState("ALL");
  if (loading) return <Loading label="Loading players\u2026" />;

  const rows = [];
  teams.forEach((t) => {
    if (platFilter !== "ALL" && t.platform !== platFilter) return;
    if (t.platform === "sleeper") {
      (t.rosterIds || []).forEach((pid) => rows.push({ id: `${t.id}-${pid}`, ...playerInfo(pid), teamName: t.teamName, leagueName: t.leagueName, platform: t.platform }));
    } else {
      (t.roster || []).forEach((p) => rows.push({ id: `${t.id}-${p.player_id}`, name: p.name, position: p.position, team: p.team, status: p.status, teamName: t.teamName, leagueName: t.leagueName, platform: t.platform }));
    }
  });
  const filtered = rows.filter((r) => {
    if (posFilter !== "ALL" && r.position !== posFilter) return false;
    if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const positions = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#8B95A1" }} />
          <input className="sc-input" style={{ width: "100%", paddingLeft: 30 }} placeholder="Search your players\u2026" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="sc-select" value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
          {positions.map((p) => <option key={p} value={p}>{p === "ALL" ? "All positions" : p}</option>)}
        </select>
        <select className="sc-select" value={platFilter} onChange={(e) => setPlatFilter(e.target.value)}>
          <option value="ALL">All platforms</option><option value="sleeper">Sleeper</option><option value="yahoo">Yahoo</option><option value="espn">ESPN</option>
        </select>
      </div>
      <div style={{ fontSize: 12, color: "#8B95A1", marginBottom: 8 }}>{filtered.length} players</div>
      <table className="sc-table">
        <thead><tr><th>Pos</th><th>Player</th><th>NFL team</th><th>Status</th><th>Trend</th><th>Fantasy team</th><th>League</th></tr></thead>
        <tbody>
          {filtered.slice(0, 200).map((r) => {
            const tag = consistencyTag(r.id);
            const TrendIcon = tag.icon === "up" ? TrendingUp : tag.icon === "down" ? TrendingDown : Minus;
            return (
            <tr key={r.id}>
              <td><PosTag pos={r.position} /></td>
              <td style={{ fontWeight: 600 }}>{r.name}</td>
              <td style={{ color: "#8B95A1" }}>{r.team}</td>
              <td>{r.status && r.status !== "Active" ? <span style={{ color: "#D9534F", fontSize: 12 }}>{r.status}</span> : <span style={{ color: "#8B95A1", fontSize: 12 }}>Active</span>}</td>
              <td><span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: tag.color }}><TrendIcon size={12} />{tag.label}</span></td>
              <td>{r.teamName}</td>
              <td style={{ display: "flex", alignItems: "center", gap: 6 }}><PlatformBadge platform={r.platform} /> <span style={{ fontSize: 11, color: "#8B95A1" }}>{r.leagueName}</span></td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Lineups / start-sit ------------------------------ */

function LineupsView({ teams, loading, playerInfo }) {
  if (loading) return <Loading label="Loading lineups\u2026" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 12, color: "#8B95A1", lineHeight: 1.5 }}>
        Flags compare each starter's most recent output against your best bench option at the same
        position — a simple heuristic to demo the concept. The full app would use live projections and matchup data.
      </div>
      {teams.map((t) => <LineupCard key={t.id} team={t} playerInfo={playerInfo} />)}
    </div>
  );
}

function LineupCard({ team, playerInfo }) {
  const isSleeper = team.platform === "sleeper";
  let starters, bench;
  if (isSleeper) {
    starters = (team.starterIds || []).map((id) => ({ id, ...playerInfo(id), points: round1v(id) }));
    bench = (team.rosterIds || []).filter((id) => !(team.starterIds || []).includes(id)).map((id) => ({ id, ...playerInfo(id), points: round1v(id) }));
  } else {
    starters = (team.roster || []).filter((p) => (team.starters || []).includes(p.player_id)).map((p) => ({ id: p.player_id, name: p.name, position: p.position, points: p.points }));
    bench = (team.roster || []).filter((p) => !(team.starters || []).includes(p.player_id)).map((p) => ({ id: p.player_id, name: p.name, position: p.position, points: p.points }));
  }
  function round1v(id) { let h = 0; for (const c of id) h += c.charCodeAt(0); return Math.round(((h % 200) / 10) * 10) / 10; }

  const flags = [];
  starters.forEach((s) => {
    const betterBench = bench.filter((b) => b.position === s.position && b.points > s.points).sort((a, b) => b.points - a.points)[0];
    if (betterBench) flags.push({ out: s, in: betterBench });
  });
  starters = sortByPosition(starters);
  bench = sortByPosition(bench);

  return (
    <div className="sc-card" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{team.teamName}</div>
          <div style={{ fontSize: 11, color: "#8B95A1" }}>{team.leagueName}</div>
        </div>
        <PlatformBadge platform={team.platform} />
      </div>
      {flags.length > 0 && (
        <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {flags.slice(0, 3).map((f, i) => (
            <div key={i} style={{ fontSize: 12, background: "#F2A63D1A", border: "1px solid #F2A63D44", borderRadius: 8, padding: "6px 10px", color: "#F2A63D" }}>
              <Flame size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              Consider {f.in.name} ({f.in.points} pts) over {f.out.name} ({f.out.points} pts) at {f.out.position}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: "#8B95A1", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Starting</div>
          {starters.map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #20272E" }}>
              <span><PosTag pos={s.position} /> <span style={{ marginLeft: 6 }}>{s.name}</span></span>
              {s.status && s.status !== "Active" && <AlertTriangle size={13} color="#D9534F" />}
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#8B95A1", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Bench</div>
          {bench.slice(0, 8).map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #20272E", color: "#8B95A1" }}>
              <span><PosTag pos={s.position} /> <span style={{ marginLeft: 6 }}>{s.name}</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Charts ------------------------------ */

function ChartsView({ sleeperTeams, allTeams, loading }) {
  const [leagueId, setLeagueId] = useState(null);
  if (loading) return <Loading label="Loading chart data\u2026" />;
  const uniqueLeagues = sleeperTeams.map((t) => [t.leagueId, t.leagueName]);
  const activeLeagueId = leagueId || (uniqueLeagues[0] && uniqueLeagues[0][0]);
  const activeTeam = sleeperTeams.find((t) => t.leagueId === activeLeagueId);

  const posBreakdown = useMemo(() => {
    const counts = {};
    allTeams.forEach((t) => (t.roster || []).forEach((r) => { counts[r.position] = (counts[r.position] || 0) + 1; }));
    return Object.entries(counts).map(([position, count]) => ({ position, count }));
  }, [allTeams]);
  const teamPointsBar = allTeams.map((t) => ({ name: t.teamName, points: +(t.pointsFor || 0).toFixed(1) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Weekly points (Sleeper league)</div>
          {uniqueLeagues.length > 1 && (
            <select className="sc-select" value={activeLeagueId} onChange={(e) => setLeagueId(e.target.value)}>
              {uniqueLeagues.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
        </div>
        {activeTeam?.weeklyPoints?.length > 0 ? (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={activeTeam.weeklyPoints}>
                <CartesianGrid stroke="#2A323B" vertical={false} />
                <XAxis dataKey="week" stroke="#8B95A1" fontSize={12} />
                <YAxis stroke="#8B95A1" fontSize={12} />
                <Tooltip contentStyle={{ background: "#1D242B", border: "1px solid #2A323B", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="points" stroke="#F2A63D" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyState icon={BarChart3} title="Season hasn't started" body="This chart populates once week 1 is complete." />}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Points for, by team</div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={teamPointsBar} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid stroke="#2A323B" horizontal={false} />
              <XAxis type="number" stroke="#8B95A1" fontSize={12} />
              <YAxis type="category" dataKey="name" stroke="#8B95A1" fontSize={11} width={130} />
              <Tooltip contentStyle={{ background: "#1D242B", border: "1px solid #2A323B", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="points" fill="#4C9A5B" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      {posBreakdown.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Roster position mix (demo teams)</div>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={posBreakdown} dataKey="count" nameKey="position" outerRadius={90} label={(d) => d.position}>
                  {posBreakdown.map((entry, i) => <Cell key={i} fill={posColor(entry.position)} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#1D242B", border: "1px solid #2A323B", borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Trades ------------------------------ */

function TradesView({ teams, loading, playerInfo }) {
  const [myTeamId, setMyTeamId] = useState(null);
  const [oppId, setOppId] = useState(null);
  const [sendMine, setSendMine] = useState([]);
  const [sendTheirs, setSendTheirs] = useState([]);
  if (loading) return <Loading label="Loading rosters\u2026" />;
  if (teams.length === 0) return <EmptyState icon={ArrowLeftRight} title="No teams yet" body="Nothing to show." />;

  const myTeam = teams.find((t) => t.id === myTeamId) || teams[0];
  const opponents = myTeam.leagueOpponents || [];
  const opponent = opponents.find((o) => o.id === oppId) || opponents[0];

  const myRoster = myTeam.platform === "sleeper"
    ? (myTeam.rosterIds || []).map((id) => { const info = playerInfo(id); return { id, ...info, value: playerValue(id, info.position) }; })
    : (myTeam.roster || []).map((p) => ({ id: p.player_id, name: p.name, position: p.position, value: playerValue(p.player_id, p.position) }));
  const theirRoster = (opponent?.roster || []).map((p) => ({ id: p.id, name: p.name, position: p.position, value: playerValue(p.id, p.position) }));

  function toggle(list, setList, id) { setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]); }
  const valueMine = myRoster.filter((p) => sendMine.includes(p.id)).reduce((s, p) => s + (p.value || 0), 0);
  const valueTheirs = theirRoster.filter((p) => sendTheirs.includes(p.id)).reduce((s, p) => s + (p.value || 0), 0);
  const diff = valueMine - valueTheirs;

  return (
    <div>
      <div style={{ fontSize: 12, color: "#8B95A1", marginBottom: 16, lineHeight: 1.5 }}>
        Pick one of your teams, then pick another team in that same league to propose a trade with.
        Values here are a rough demo heuristic — the full app would generate this with current rankings and matchup context.
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <select className="sc-select" value={myTeam.id} onChange={(e) => { setMyTeamId(e.target.value); setOppId(null); setSendMine([]); setSendTheirs([]); }}>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.teamName} ({t.leagueName})</option>)}
        </select>
        <select className="sc-select" value={opponent?.id || ""} onChange={(e) => { setOppId(e.target.value); setSendTheirs([]); }}>
          {opponents.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      {opponents.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="No other teams found" body="This league doesn't have opponent roster data yet." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <TradeSide title={myTeam.teamName} roster={myRoster} picked={sendMine} onToggle={(id) => toggle(sendMine, setSendMine, id)} />
          <TradeSide title={opponent?.name} roster={theirRoster} picked={sendTheirs} onToggle={(id) => toggle(sendTheirs, setSendTheirs, id)} />
        </div>
      )}

      {(sendMine.length > 0 || sendTheirs.length > 0) && (
        <div className="sc-card" style={{ padding: 14, marginTop: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Trade value read</div>
          <div style={{ display: "flex", gap: 20, fontSize: 13 }}>
            <div>{myTeam.teamName} sends: <b>{valueMine.toFixed(1)}</b> value</div>
            <div>{opponent?.name} sends: <b>{valueTheirs.toFixed(1)}</b> value</div>
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: Math.abs(diff) < 3 ? "#4C9A5B" : "#F2A63D" }}>
            {Math.abs(diff) < 3 ? "Roughly balanced." : diff > 0 ? `Leans toward ${opponent?.name} by about ${diff.toFixed(1)} points of value.` : `Leans toward ${myTeam.teamName} by about ${Math.abs(diff).toFixed(1)} points of value.`}
          </div>
        </div>
      )}
    </div>
  );
}

function TradeSide({ title, roster, picked, onToggle }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
      <div className="sc-card" style={{ padding: 10, maxHeight: 320, overflowY: "auto" }}>
        {roster.length === 0 && <div style={{ fontSize: 12, color: "#8B95A1", padding: 8 }}>No players.</div>}
        {roster.map((p) => (
          <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #20272E" }}>
            <input type="checkbox" checked={picked.includes(p.id)} onChange={() => onToggle(p.id)} />
            <PosTag pos={p.position} /><span style={{ flex: 1 }}>{p.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Draft recap ------------------------------ */


function DraftView({ sleeperLeagues, loading }) {
  const [leagueIdx, setLeagueIdx] = useState(0);
  if (loading) return <Loading label="Loading draft history\u2026" />;
  if (!sleeperLeagues || sleeperLeagues.length === 0) return <EmptyState icon={Trophy} title="No draft data yet" body="Nothing to show." />;
  const entry = sleeperLeagues[Math.min(leagueIdx, sleeperLeagues.length - 1)];
  const picks = [...entry.draftPicks].sort((a, b) => a.pick_no - b.pick_no);

  return (
    <div>
      <select className="sc-select" style={{ marginBottom: 14 }} value={leagueIdx} onChange={(e) => setLeagueIdx(Number(e.target.value))}>
        {sleeperLeagues.map((e, i) => <option key={e.league.league_id} value={i}>{e.league.name}</option>)}
      </select>
      <table className="sc-table">
        <thead><tr><th>Pick</th><th>Round</th><th>Player</th><th>Pos</th><th>Team</th><th>Drafted by</th></tr></thead>
        <tbody>
          {picks.map((p) => (
            <tr key={p.pick_no}>
              <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{p.pick_no}</td>
              <td>{p.round}</td>
              <td style={{ fontWeight: 600 }}>{p.metadata?.first_name} {p.metadata?.last_name}</td>
              <td><PosTag pos={p.metadata?.position || "\u2014"} /></td>
              <td style={{ color: "#8B95A1" }}>{p.metadata?.team || "\u2014"}</td>
              <td>{p.picked_by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ News / trending ------------------------------ */

function NewsView({ trending, teams, playerInfo, loading }) {
  if (loading) return <Loading label="Loading trending players\u2026" />;
  const myPlayerIds = new Set();
  teams.forEach((t) => { if (t.platform === "sleeper") (t.rosterIds || []).forEach((id) => myPlayerIds.add(id)); });
  const rows = trending.map((t) => ({ ...t, ...playerInfo(t.player_id), mine: myPlayerIds.has(t.player_id) }));

  const recs = [];
  teams.forEach((t) => {
    const grades = computeTeamGrades(t, playerInfo);
    const weakest = GRADE_POSITIONS.map((p) => ({ pos: p, ...grades[p] })).sort((a, b) => a.percentile - b.percentile)[0];
    if (!weakest || weakest.percentile > 0.45) return;
    const candidate = rows.find((r) => r.position === weakest.pos && !r.mine);
    if (candidate) recs.push({ team: t, weakest, candidate });
  });

  return (
    <div>
      {recs.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#8B95A1", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Recommended for your gaps</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
            {recs.map((r, i) => (
              <div key={i} className="sc-card" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, borderColor: "#F2A63D" }}>
                <Flame size={14} color="#F2A63D" />
                <PosTag pos={r.candidate.position} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{r.candidate.name}</span>
                <span style={{ fontSize: 12, color: "#8B95A1", flex: 1 }}>trending, {r.candidate.team}</span>
                <span style={{ fontSize: 11, color: "#F2A63D", fontWeight: 600 }}>
                  {r.team.teamName} is {r.weakest.letter}-graded at {r.weakest.pos}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: "#8B95A1", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Trending adds, last 48 hours</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.player_id} className="sc-card" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, borderColor: r.mine ? "#F2A63D" : "#2A323B" }}>
            <TrendingUp size={15} color="#4C9A5B" />
            <PosTag pos={r.position} />
            <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{r.name}</span>
            <span style={{ fontSize: 12, color: "#8B95A1" }}>{r.team}</span>
            <span style={{ fontSize: 11, color: "#8B95A1" }}>{r.count?.toLocaleString?.() || r.count} adds</span>
            {r.mine && <span style={{ fontSize: 10, fontWeight: 700, color: "#F2A63D" }}>ON YOUR TEAM</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
