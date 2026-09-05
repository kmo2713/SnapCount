"use client";

/**
 * The game-day poll loop.
 *
 * Written from scratch because there is nothing to reuse: the dashboard's only
 * refresh is a button, and the app carries no SWR or React Query. It keeps the
 * same idiom that button uses — a plain `fetch` with `cache: "no-store"` — and
 * adds the three things a live view needs.
 *
 *  1. It stops while the tab is hidden. A phone in a pocket polling every 20
 *     seconds all afternoon is a battery cost with nobody watching, and the
 *     first thing you want on coming back is a fresh number anyway, which is
 *     why becoming visible triggers an immediate fetch rather than waiting out
 *     the remaining interval.
 *  2. It slows down when nothing is live. Before kickoff and after the last
 *     whistle the payload cannot change meaningfully, so the interval backs
 *     off — `anyLive` in the payload is what decides, so the server's view of
 *     "is football happening" drives the client's cadence.
 *  3. It never renders an error in place of data. A failed poll keeps the last
 *     good payload and surfaces the failure alongside it, because a dropped
 *     request mid-drive should not blank a screen you are actively reading.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { GamedayData } from "@/lib/domain/gameday";

/** While at least one game is in progress. */
const LIVE_INTERVAL_MS = 25_000;

/**
 * When nothing is live. Long enough to be nearly free, short enough that the
 * page notices kickoff on its own without being reloaded.
 */
const IDLE_INTERVAL_MS = 5 * 60_000;

export interface GamedayPoll {
  data: GamedayData;
  /** ISO time the displayed payload was assembled. Rendered by <DataAge>. */
  generatedAt: string;
  /** True while a fetch is in flight, for a spinner that does not jump. */
  refreshing: boolean;
  /** The last poll failure, cleared by the next success. */
  error: string | null;
  /** Poll now — the manual refresh affordance. */
  refresh: () => void;
}

export function useGamedayPoll(initial: GamedayData): GamedayPoll {
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Held in a ref as well as in state so the interval callback can see whether
   * a fetch is already running without being re-created every time that
   * changes — which would restart the timer on every poll.
   */
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await fetch("/api/gameday", { cache: "no-store" });
      if (!res.ok) {
        // The route answers failures as { error }, so prefer that to a status.
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setData((await res.json()) as GamedayData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  /* -- the interval, re-armed when the live/idle cadence changes -- */
  useEffect(() => {
    const interval = data.anyLive ? LIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, interval);
    return () => window.clearInterval(id);
  }, [data.anyLive, poll]);

  /* -- catch up the moment the tab comes back -- */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [poll]);

  /*
   * There is deliberately no clock in this hook.
   *
   * "Updated 12s ago" needs a 1 Hz tick, and running it here re-rendered the
   * entire screen once a second — the rooting bar, all nine matchup cards, the
   * whole game wall, and both chart trees in an open drill-in — to advance one
   * label. That was roughly sixty times the render work of the poll it
   * decorated, and it kept running while the tab was hidden, undoing the
   * battery saving the rest of this hook exists for.
   *
   * The timestamp is handed out raw and counted by a leaf component instead,
   * so only that node re-renders. See `DataAge` in `GamedayShell`.
   *
   * `poll` is returned by identity rather than wrapped in a fresh arrow, so
   * consumers can memoise children that take it.
   */
  return { data, generatedAt: data.generatedAt, refreshing, error, refresh: poll };
}
