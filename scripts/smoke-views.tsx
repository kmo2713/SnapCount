/**
 * Renders every view against real data to catch crashes that the default tab
 * would never surface. Run with `npx tsx scripts/smoke-views.tsx`.
 *
 * This is a smoke test, not a snapshot test: it asserts each view renders and
 * produces markup, not what that markup says.
 */
import "dotenv/config";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadDashboard } from "../src/lib/data/dashboard";
import type { DashboardData } from "../src/lib/domain/types";

import { OverviewView } from "../src/components/views/OverviewView";
import { PowerRankingsView } from "../src/components/views/PowerRankingsView";
import { StandingsView } from "../src/components/views/StandingsView";
import { TeamsView } from "../src/components/views/TeamsView";
import { PlayersView } from "../src/components/views/PlayersView";
import { LineupsView } from "../src/components/views/LineupsView";
import { InjuryWatchView } from "../src/components/views/InjuryWatchView";
import { ByeWeekView } from "../src/components/views/ByeWeekView";
import { ChartsView } from "../src/components/views/ChartsView";
import { TradesView } from "../src/components/views/TradesView";
import { DraftView } from "../src/components/views/DraftView";
import { WaiverWireView } from "../src/components/views/WaiverWireView";
import { MatchupView } from "../src/components/views/MatchupView";
import { closeDb } from "../src/lib/db/client";

const noop = () => {};

function cases(data: DashboardData): Array<[string, ReactElement]> {
  return [
    [
      "Overview",
      createElement(OverviewView, { data, onSelect: noop, onOpenMatchup: noop }),
    ],
    [
      "MatchupList",
      createElement(MatchupView, {
        data,
        selectedTeamId: null,
        onSelect: noop,
        onBack: noop,
      }),
    ],
    [
      "MatchupDetail",
      createElement(MatchupView, {
        data,
        // Whichever team actually has a matchup this week.
        selectedTeamId: data.teams.find((t) => t.matchup)?.id ?? null,
        onSelect: noop,
        onBack: noop,
      }),
    ],
    ["PowerRankings", createElement(PowerRankingsView, { data, onSelect: noop })],
    ["Standings", createElement(StandingsView, { data })],
    [
      "Teams",
      createElement(TeamsView, { data, selectedTeamId: null, onSelect: noop }),
    ],
    ["Players", createElement(PlayersView, { data })],
    ["Lineups", createElement(LineupsView, { data })],
    ["InjuryWatch", createElement(InjuryWatchView, { data })],
    ["ByeWeeks", createElement(ByeWeekView, { data })],
    ["Charts", createElement(ChartsView, { data })],
    ["Trades", createElement(TradesView, { data })],
    ["Draft", createElement(DraftView, { data })],
    ["WaiverWire", createElement(WaiverWireView, { data })],
  ];
}

/** An empty dataset must render empty states, not throw. */
function emptyData(base: DashboardData): DashboardData {
  return {
    ...base,
    teams: [],
    trending: [],
    drafts: [],
    byeWeeks: {},
  };
}

async function main() {
  const data = await loadDashboard();
  console.log(
    `Loaded ${data.teams.length} teams from "${data.source}" (${data.state.season}, week ${data.viewedWeek}).\n`,
  );

  let failures = 0;

  for (const [label, dataset] of [
    ["real data", data],
    ["empty data", emptyData(data)],
  ] as const) {
    console.log(`--- ${label} ---`);
    for (const [name, element] of cases(dataset)) {
      try {
        const html = renderToStaticMarkup(element);
        if (!html || html.length === 0) throw new Error("rendered nothing");
        console.log(`  ok    ${name.padEnd(15)} ${html.length} chars`);
      } catch (err) {
        failures++;
        console.error(
          `  FAIL  ${name.padEnd(15)} ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  console.log(failures === 0 ? "\nAll views rendered." : `\n${failures} view(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Smoke test failed:", err);
    process.exitCode = 1;
  })
  .finally(closeDb);
