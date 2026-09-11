"use client";

/**
 * Where to look.
 *
 * This is the feature the whole page is built around, and it only works
 * because nine leagues are in one place. Your 75 starter slots span 31 of the
 * 32 NFL teams and your opponents' span 29, so nearly every game has something
 * of yours and something against you in it. Nobody holds that in their head.
 *
 * Two consequences of that spread shape this component, and both were found by
 * running the real numbers rather than reasoning about them:
 *
 *  - **"Root for GB" is usually unanswerable.** With players on both sides of
 *    most games there is no side to name, so `rootFor` comes back null far more
 *    often than not. The tile therefore leads with direction and magnitude and
 *    treats a named side as a bonus, not as the headline.
 *  - **Nearly every game is technically "conflicted".** A flag that fires on
 *    every card carries no signal, so it is shown only when the opposing pull
 *    is big enough to change how you would feel about the game — see
 *    CONFLICT_SHARE.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/ui/Modal";

import { fmt } from "@/components/ui/primitives";
import type { NflGame, RootingInterest, RootingMode } from "@/lib/domain/gameday";

/**
 * How much of a game's total pull must run the *other* way before it is worth
 * calling conflicted.
 *
 * With a lineup this spread, a token opposing contribution is the normal case
 * rather than the interesting one. A third is the point where the game stops
 * being "good for you with a caveat" and starts being genuinely split.
 */
const CONFLICT_SHARE = 0.33;

function isMeaningfullyConflicted(interest: RootingInterest): boolean {
  if (!interest.conflicted) return false;

  let helps = 0;
  let hurts = 0;
  for (const c of interest.contributions) {
    if (c.net > 0) helps += c.net;
    else hurts += -c.net;
  }

  const total = helps + hurts;
  if (total <= 0) return false;
  return Math.min(helps, hurts) / total >= CONFLICT_SHARE;
}

export function RootingBar({
  rooting,
  games,
  mode,
  onMode,
  open,
  onToggle,
}: {
  rooting: RootingInterest[];
  games: Map<string, NflGame>;
  mode: RootingMode;
  onMode: (m: RootingMode) => void;
  /** Collapsed, this is one line — see the comment on the toggle below. */
  open: boolean;
  onToggle: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="sc-gameday-rooting">
      <div className="sc-gameday-rooting-head">
        {/*
          The whole title row is the toggle, not a separate icon button beside
          it. This band is the top ~130px of a phone screen and the thing you
          most often want is it gone; a 44px target the width of the screen is
          the difference between that being a gesture and being a chore.
        */}
        <button
          type="button"
          className="sc-gameday-rooting-toggle"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="sc-rooting-strip"
        >
          <Chevron size={13} style={{ flexShrink: 0 }} />
          <span className="sc-section-title">Where to look</span>
          {rooting.length > 0 && (
            <span
              className="sc-mono"
              style={{ fontSize: 10, color: "var(--sc-text-muted)" }}
            >
              {rooting.length} games
            </span>
          )}
        </button>

        <span className="sc-note sc-gameday-caveat" style={{ margin: 0, fontSize: 11 }}>
          {mode === "leverage"
            ? "net wins swung, weighted by how much a point moves each league — a model, not a prediction"
            : "raw projected point swing, unweighted"}
        </span>

        {/* Hidden with the strip: the unit only means something beside it. */}
        {open && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 4, flexShrink: 0 }}>
            {(["leverage", "raw"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className="sc-btn"
                onClick={() => onMode(m)}
                aria-pressed={mode === m}
                style={{
                  fontSize: 11,
                  minHeight: 44,
                  padding: "0 10px",
                  color: mode === m ? "var(--sc-accent)" : undefined,
                  borderColor: mode === m ? "var(--sc-accent-border)" : undefined,
                }}
              >
                {m === "leverage" ? "Leverage" : "Raw points"}
              </button>
            ))}
          </div>
        )}
      </div>

      {!open ? null : rooting.length === 0 ? (
        <div className="sc-note" style={{ margin: 0 }}>
          None of your players are in this week&apos;s games.
        </div>
      ) : (
        <div
          id="sc-rooting-strip"
          className="sc-gameday-strip"
          tabIndex={0}
          role="group"
          aria-label="Games by rooting interest"
        >
          {/*
            On a laptop this is a row you scan across. On a phone it was 2,328px
            of sideways scrolling inside sticky chrome, so it becomes a vertical
            list showing the three games that matter most — the order is by
            rooting interest, so the top of it is the point — with the rest a
            tap away. The cut is made in CSS rather than by slicing here,
            because the dialog below renders the same list in full.
          */}
          {rooting.map((r) => (
            <RootingTile
              key={r.eventId}
              interest={r}
              game={games.get(r.eventId)}
              mode={mode}
            />
          ))}
        </div>
      )}

      {open && rooting.length > 0 && (
        <button
          type="button"
          className="sc-btn sc-rooting-all"
          onClick={() => setShowAll(true)}
        >
          All {rooting.length} games
        </button>
      )}

      <Modal
        open={showAll}
        onClose={() => setShowAll(false)}
        title="Where to look"
        subtitle={
          mode === "leverage"
            ? "Net wins swung across your leagues — a model, not a prediction"
            : "Raw projected point swing, unweighted"
        }
      >
        <div className="sc-rooting-list">
          {rooting.map((r) => (
            <RootingTile
              key={r.eventId}
              interest={r}
              game={games.get(r.eventId)}
              mode={mode}
            />
          ))}
        </div>
      </Modal>
    </div>
  );
}

function RootingTile({
  interest,
  game,
  mode,
}: {
  interest: RootingInterest;
  game: NflGame | undefined;
  mode: RootingMode;
}) {
  const color =
    interest.direction === "for"
      ? "var(--sc-green)"
      : interest.direction === "against"
        ? "var(--sc-red)"
        : "var(--sc-text-muted)";

  const conflicted = isMeaningfullyConflicted(interest);

  /*
   * Emphasis tracks strength rather than size. A slate where six games matter
   * a lot should not be six shouting cards — the border earns attention only
   * for the games at the top of the order.
   */
  const emphasised = interest.strength > 0.6;

  /*
   * Leverage is a sum of win-probability shifts across every league, so it is
   * not a percentage and routinely exceeds 1. Rendering it as one produced
   * "-103.5 win %", which is impossible on its face and quietly wrong about
   * what the number means.
   *
   * Expressed in whole wins instead: 1.00 is one entire league win flipped, so
   * "-1.04 wins" says this game is worth about one win against you spread
   * across the leagues it touches. Same number, a unit that can be read.
   */
  const value =
    mode === "raw"
      ? `${interest.net > 0 ? "+" : ""}${fmt(interest.net, 0)}`
      : `${interest.net > 0 ? "+" : ""}${fmt(interest.net, 2)}`;

  const leagues = interest.contributions.length;

  return (
    <div
      className="sc-card"
      style={{
        padding: "8px 10px",
        minWidth: 138,
        borderColor: emphasised ? color : "var(--sc-border)",
      }}
      title={
        interest.contributions.length > 0
          ? interest.contributions
              .map((c) => `${c.leagueName}: ${c.net > 0 ? "+" : ""}${fmt(c.net, 2)}`)
              .join("\n")
          : undefined
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>
          {game?.shortName ?? interest.eventId}
        </span>
        {game?.state === "in" && (
          <span
            role="img"
            aria-label="live"
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "var(--sc-red)",
              flexShrink: 0,
            }}
          />
        )}
      </div>

      <div className="sc-mono" style={{ fontSize: 16, fontWeight: 700, color }}>
        {value}
      </div>

      <div style={{ fontSize: 10, color: "var(--sc-text-muted)" }}>
        {mode === "raw" ? "proj pts" : "wins"} · {leagues} {leagues === 1 ? "league" : "leagues"}
      </div>

      {/*
        A named side when there is one. With players on both sides of most
        games there usually is not, and saying nothing is better than saying
        something wrong.
      */}
      {interest.rootFor && (
        <div style={{ fontSize: 10, color, fontWeight: 700 }}>root {interest.rootFor}</div>
      )}

      {conflicted && (
        <div style={{ fontSize: 9, color: "var(--sc-orange)", marginTop: 2 }}>
          pulls both ways
        </div>
      )}
    </div>
  );
}
